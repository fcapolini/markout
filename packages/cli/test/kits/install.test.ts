import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addKits, parseSpec, restoreKits } from '../../src/kits/install';

/**
 * `markout add` and `markout restore`, against a registry that is a fixture.
 *
 * The network is stubbed rather than reached: what is worth testing here is
 * the contract with the registry's SHAPE -- a packument, a tarball, a
 * checksum -- and every one of those is a fact about the format rather than
 * about npmjs.org being up. See docs/design/without-node.md.
 */

const temps: string[] = [];
let registry: Map<string, { versions: Record<string, unknown> }>;
let tarballs: Map<string, Buffer>;

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()!;
    fs.existsSync(dir) && fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function temp(prefix = 'markout-install-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** one 512-byte ustar header */
function header(name: string, size: number): Buffer {
  const block = Buffer.alloc(512);
  block.write(name, 0, 'utf8');
  block.write('000644 \0', 100);
  block.write(size.toString(8).padStart(11, '0') + ' ', 124);
  block.write('        ', 148);
  block.write('0', 156);
  block.write('ustar\0', 257);
  return block;
}

function tarball(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, body] of Object.entries(files)) {
    const bytes = Buffer.from(body, 'utf8');
    blocks.push(header(`package/${name}`, bytes.length));
    const padded = Buffer.alloc(Math.ceil(bytes.length / 512) * 512);
    bytes.copy(padded);
    blocks.push(padded);
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

/** publish `name@version` into the fixture registry */
function publish(
  name: string,
  version: string,
  extra: Record<string, unknown> = { markout: { root: '/a-kit' } },
  files: Record<string, string> = {}
) {
  const tgz = tarball({
    'package.json': JSON.stringify({ name, version, ...extra }),
    ...files,
  });
  const url = `https://fixture.test/${name}/-/${version}.tgz`;
  tarballs.set(url, tgz);
  const entry = registry.get(name) ?? { versions: {} };
  entry.versions[version] = {
    name,
    version,
    ...extra,
    dist: {
      tarball: url,
      integrity: 'sha512-' + crypto.createHash('sha512').update(tgz).digest('base64'),
    },
  };
  registry.set(name, entry);
}

beforeEach(() => {
  registry = new Map();
  tarballs = new Map();
  vi.stubEnv('MARKOUT_REGISTRY', 'https://fixture.test');
  vi.stubEnv('MARKOUT_CACHE', temp('markout-cache-'));
  vi.stubGlobal('fetch', async (url: string) => {
    const tgz = tarballs.get(url);
    if (tgz) {
      return { ok: true, status: 200, arrayBuffer: async () => tgz } as unknown as Response;
    }
    const name = decodeURIComponent(url.replace('https://fixture.test/', ''));
    const found = registry.get(name);
    if (!found) {
      return { ok: false, status: 404, statusText: 'Not Found' } as unknown as Response;
    }
    const versions = Object.keys(found.versions);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        'dist-tags': { latest: versions[versions.length - 1] },
        versions: found.versions,
      }),
    } as unknown as Response;
  });
});

/** a project with a docroot, and a package.json so `.markout` lands at its root */
function project(): { root: string; docroot: string } {
  const root = temp();
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"app"}');
  const docroot = path.join(root, 'site');
  fs.mkdirSync(docroot);
  return { root, docroot };
}

const kitJson = (root: string) => path.join(root, '.markout', 'kits.json');
const kitDir = (root: string, name: string) =>
  path.join(root, '.markout', 'kits', ...name.split('/'));

describe('parseSpec', () => {
  it('reads a bare name, a version, and a scope', () => {
    expect(parseSpec('a-kit')).toEqual({ name: 'a-kit', version: 'latest' });
    expect(parseSpec('a-kit@1.2.3')).toEqual({ name: 'a-kit', version: '1.2.3' });
    expect(parseSpec('@scope/a-kit')).toEqual({ name: '@scope/a-kit', version: 'latest' });
    expect(parseSpec('@scope/a-kit@1.2.3')).toEqual({
      name: '@scope/a-kit',
      version: '1.2.3',
    });
  });
});

describe('addKits', () => {
  it('pins the version that arrived, not the word that was asked for', async () => {
    // `latest` is a moving answer, and the manifest has to record the one
    // this run actually got or a clone builds something else
    const { root, docroot } = project();
    publish('a-kit', '1.0.0');
    publish('a-kit', '1.1.0');
    const report = await addKits(docroot, ['a-kit']);
    expect(report.installed).toEqual(['a-kit@1.1.0']);
    expect(JSON.parse(fs.readFileSync(kitJson(root), 'utf8')).kits).toEqual({
      'a-kit': '1.1.0',
    });
  });

  it('takes the second install from the shared cache, with no download', async () => {
    // every project after the first is a file copy: instant, and offline
    publish('a-kit', '1.0.0');
    await addKits(project().docroot, ['a-kit']);
    const url = 'https://fixture.test/a-kit/-/1.0.0.tgz';
    const bytes = tarballs.get(url)!;
    tarballs.delete(url);
    const { root, docroot } = project();
    const report = await addKits(docroot, ['a-kit']);
    expect(report.errors).toEqual([]);
    expect(fs.existsSync(kitDir(root, 'a-kit'))).toBe(true);
    tarballs.set(url, bytes);
  });

  it('re-downloads rather than trusting a cache entry that was tampered with', async () => {
    // a cached file is bytes on a disk other things can write to; checking it
    // costs one hash and is never skipped
    publish('a-kit', '1.0.0');
    await addKits(project().docroot, ['a-kit']);
    for (const entry of fs.readdirSync(process.env.MARKOUT_CACHE!)) {
      fs.writeFileSync(path.join(process.env.MARKOUT_CACHE!, entry), 'not a tarball');
    }
    const { root, docroot } = project();
    expect((await addKits(docroot, ['a-kit'])).errors).toEqual([]);
    expect(fs.existsSync(kitDir(root, 'a-kit'))).toBe(true);
  });

  it('writes the files, the pin and the .gitignore', async () => {
    const { root, docroot } = project();
    publish('@markout-lang/a-kit', '1.0.0', { markout: { root: '/a-kit' } }, {
      'all.htm': '<div></div>',
    });
    const report = await addKits(docroot, ['@markout-lang/a-kit']);
    expect(report.errors).toEqual([]);
    expect(report.installed).toEqual(['@markout-lang/a-kit@1.0.0']);
    expect(
      fs.readFileSync(path.join(kitDir(root, '@markout-lang/a-kit'), 'all.htm'), 'utf8')
    ).toBe('<div></div>');
    expect(JSON.parse(fs.readFileSync(kitJson(root), 'utf8')).kits).toEqual({
      '@markout-lang/a-kit': '1.0.0',
    });
    expect(fs.existsSync(path.join(root, '.markout', '.gitignore'))).toBe(true);
  });

  it('takes an exact version when asked for one', async () => {
    const { root, docroot } = project();
    publish('a-kit', '1.0.0');
    publish('a-kit', '2.0.0');
    await addKits(docroot, ['a-kit@1.0.0']);
    expect(JSON.parse(fs.readFileSync(kitJson(root), 'utf8')).kits).toEqual({
      'a-kit': '1.0.0',
    });
  });

  it('refuses a package that is not a kit, before downloading anything', async () => {
    const { root, docroot } = project();
    publish('express', '5.0.0', {});
    const report = await addKits(docroot, ['express']);
    expect(report.installed).toEqual([]);
    expect(report.errors[0]).toContain('is not a kit');
    // nothing written at all -- not the directory, not an empty manifest
    expect(fs.existsSync(path.join(root, '.markout'))).toBe(false);
  });

  it('says which kit failed and still installs the others', async () => {
    const { root, docroot } = project();
    publish('good-kit', '1.0.0');
    const report = await addKits(docroot, ['good-kit', 'no-such-kit']);
    expect(report.installed).toEqual(['good-kit@1.0.0']);
    expect(report.errors[0]).toContain('no package "no-such-kit"');
    expect(JSON.parse(fs.readFileSync(kitJson(root), 'utf8')).kits).toEqual({
      'good-kit': '1.0.0',
    });
  });

  it('keeps the pins already in the manifest', async () => {
    const { root, docroot } = project();
    publish('a-kit', '1.0.0');
    publish('b-kit', '2.0.0');
    await addKits(docroot, ['a-kit']);
    await addKits(docroot, ['b-kit']);
    expect(JSON.parse(fs.readFileSync(kitJson(root), 'utf8')).kits).toEqual({
      'a-kit': '1.0.0',
      'b-kit': '2.0.0',
    });
  });

  it('refuses a tarball whose bytes do not match the published checksum', async () => {
    const { root, docroot } = project();
    publish('a-kit', '1.0.0');
    const entry = registry.get('a-kit')!.versions['1.0.0'] as { dist: { integrity: string } };
    entry.dist.integrity = 'sha512-' + Buffer.from('wrong').toString('base64');
    const report = await addKits(docroot, ['a-kit']);
    expect(report.errors[0]).toContain('does not match the checksum');
    expect(fs.existsSync(kitDir(root, 'a-kit'))).toBe(false);
  });

  it('leaves the previous copy in place when a replacement fails', async () => {
    const { root, docroot } = project();
    publish('a-kit', '1.0.0', { markout: { root: '/a-kit' } }, { 'all.htm': 'first' });
    await addKits(docroot, ['a-kit@1.0.0']);
    publish('a-kit', '2.0.0');
    const entry = registry.get('a-kit')!.versions['2.0.0'] as { dist: { integrity: string } };
    entry.dist.integrity = 'sha512-nope';
    await addKits(docroot, ['a-kit@2.0.0']);
    // a kit that half exists is worse than one that does not: discovery would
    // mount it and blame the author for its missing files
    expect(fs.readFileSync(path.join(kitDir(root, 'a-kit'), 'all.htm'), 'utf8')).toBe(
      'first'
    );
  });
});

describe('restoreKits', () => {
  it('fetches everything the manifest pins', async () => {
    const { root, docroot } = project();
    publish('a-kit', '1.0.0');
    publish('b-kit', '3.0.0');
    fs.mkdirSync(path.join(root, '.markout'), { recursive: true });
    fs.writeFileSync(
      kitJson(root),
      JSON.stringify({ kits: { 'a-kit': '1.0.0', 'b-kit': '3.0.0' } })
    );
    const report = await restoreKits(docroot);
    expect(report.errors).toEqual([]);
    expect(report.installed.sort()).toEqual(['a-kit@1.0.0', 'b-kit@3.0.0']);
    expect(fs.existsSync(kitDir(root, 'a-kit'))).toBe(true);
  });

  it('is idempotent, and never writes the manifest', async () => {
    // the honest thing for a CI script to do is run it unconditionally
    const { root, docroot } = project();
    publish('a-kit', '1.0.0');
    await addKits(docroot, ['a-kit']);
    const before = fs.statSync(kitJson(root)).mtimeMs;
    const report = await restoreKits(docroot);
    expect(report.installed).toEqual([]);
    expect(report.unchanged).toEqual(['a-kit@1.0.0']);
    expect(report.pinned).toBeUndefined();
    expect(fs.statSync(kitJson(root)).mtimeMs).toBe(before);
  });

  it('replaces a copy that drifted from the pin', async () => {
    const { root, docroot } = project();
    publish('a-kit', '1.0.0', { markout: { root: '/a-kit' } }, { 'all.htm': 'old' });
    await addKits(docroot, ['a-kit@1.0.0']);
    publish('a-kit', '2.0.0', { markout: { root: '/a-kit' } }, { 'all.htm': 'new' });
    fs.writeFileSync(kitJson(root), JSON.stringify({ kits: { 'a-kit': '2.0.0' } }));
    await restoreKits(docroot);
    expect(fs.readFileSync(path.join(kitDir(root, 'a-kit'), 'all.htm'), 'utf8')).toBe('new');
  });

  it('says what to do when there is no manifest at all', async () => {
    const report = await restoreKits(project().docroot);
    expect(report.errors[0]).toContain('markout add');
  });

  it('passes a broken manifest through rather than fetching from it', async () => {
    const { root, docroot } = project();
    fs.mkdirSync(path.join(root, '.markout'), { recursive: true });
    fs.writeFileSync(kitJson(root), JSON.stringify({ kits: { 'a-kit': '^1.0.0' } }));
    const report = await restoreKits(docroot);
    expect(report.installed).toEqual([]);
    expect(report.errors[0]).toContain('not an exact version');
  });
});
