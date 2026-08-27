import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverKits } from '../src/kits';
import { findManifest, readManifest } from '../src/manifest';

/**
 * The manifest, and the diagnostic it exists for.
 *
 * Without it a missing kit is not a fact the compiler has: the page compiles,
 * the kit's tags render as unknown elements, and nothing names a cause. Every
 * test here is about turning that silence into a sentence, or about refusing
 * to guess at a manifest that does not say what it means. See
 * docs/design/without-node.md.
 */

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()!;
    fs.existsSync(dir) && fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** a project with a docroot under it, and whatever files were asked for */
function project(files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-manifest-'));
  temps.push(root);
  fs.mkdirSync(path.join(root, 'site'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const manifest = (kits: Record<string, string>) => JSON.stringify({ kits });

/** a kit package, in whichever store it was installed into */
function install(root: string, into: string, name: string, version: string) {
  const dir = path.join(root, ...into.split('/'), ...name.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version, markout: { root: '/' + name.split('/').pop() } })
  );
}

describe('readManifest', () => {
  it('reads the kits a project asked for', () => {
    const root = project({ '.markout/kits.json': manifest({ 'a-kit': '1.2.3' }) });
    expect(readManifest(root).manifest.kits).toEqual({ 'a-kit': '1.2.3' });
    expect(readManifest(root).errors).toEqual([]);
  });

  it('is empty and silent where there is no manifest', () => {
    // every project that installed its kits with npm, which is most of them
    const root = project();
    expect(readManifest(root).manifest.kits).toEqual({});
    expect(readManifest(root).errors).toEqual([]);
  });

  it('refuses a range, naming the rule rather than the parse', () => {
    // `^0.4.0` is a perfectly good npm range: whoever wrote it was expecting
    // a resolver this file deliberately has not got, and pinning it silently
    // would make the file mean something other than what it says
    const root = project({ '.markout/kits.json': manifest({ 'a-kit': '^0.4.0' }) });
    const { manifest: read, errors } = readManifest(root);
    expect(read.kits).toEqual({});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('not an exact version');
    expect(errors[0]).toContain('markout add a-kit');
  });

  it('accepts a prerelease and its build metadata', () => {
    const root = project({
      '.markout/kits.json': manifest({ 'a-kit': '1.0.0-beta.2', 'b-kit': '1.0.0+build.1' }),
    });
    expect(readManifest(root).errors).toEqual([]);
  });

  it('says so when the file is not JSON', () => {
    const root = project({ '.markout/kits.json': '{ oops' });
    const { errors } = readManifest(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('not valid JSON');
  });

  it('says so when kits is not an object', () => {
    const root = project({ '.markout/kits.json': '{"kits":["a-kit"]}' });
    expect(readManifest(root).errors[0]).toContain('should be an object');
  });
});

describe('findManifest', () => {
  it('walks up from the docroot, as discovery does', () => {
    const root = project({ '.markout/kits.json': manifest({ 'a-kit': '1.0.0' }) });
    const found = findManifest(path.join(root, 'site'));
    expect(found?.dir).toBe(root);
    expect(found?.manifest.kits).toEqual({ 'a-kit': '1.0.0' });
  });

  it('is undefined where no directory above has one', () => {
    expect(findManifest(path.join(project(), 'site'))).toBeUndefined();
  });
});

describe('the diagnostic discovery gains from a manifest', () => {
  it('names a kit the project asked for and has not got', () => {
    // the message the whole feature is for: without it this page compiles,
    // renders the kit's tags as unknown elements, and says nothing at all
    const root = project({
      '.markout/kits.json': manifest({ '@markout-lang/bootstrap-kit': '0.4.0' }),
    });
    const { errors } = discoverKits(path.join(root, 'site'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('@markout-lang/bootstrap-kit');
    expect(errors[0]).toContain('is not installed');
    expect(errors[0]).toContain('markout restore');
  });

  it('is quiet once the kit is there', () => {
    const root = project({ '.markout/kits.json': manifest({ 'a-kit': '1.0.0' }) });
    install(root, '.markout/kits', 'a-kit', '1.0.0');
    const { kits, errors } = discoverKits(path.join(root, 'site'));
    expect(errors).toEqual([]);
    expect(kits.map(k => k.name)).toEqual(['a-kit']);
    expect(kits[0].version).toBe('1.0.0');
    expect(kits[0].managed).toBe(true);
  });

  it('reports a managed kit that drifted from its pin', () => {
    const root = project({ '.markout/kits.json': manifest({ 'a-kit': '2.0.0' }) });
    install(root, '.markout/kits', 'a-kit', '1.0.0');
    const { errors } = discoverKits(path.join(root, 'site'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('pinned to 2.0.0');
    expect(errors[0]).toContain('1.0.0 is installed');
  });

  it('leaves an npm-installed copy to npm, pin or no pin', () => {
    // `package.json` and a lockfile already have an opinion about this
    // version; a second file arguing with them would be a conflict invented
    // here for nobody's benefit
    const root = project({ '.markout/kits.json': manifest({ 'a-kit': '2.0.0' }) });
    install(root, 'node_modules', 'a-kit', '1.0.0');
    const { kits, errors } = discoverKits(path.join(root, 'site'));
    expect(errors).toEqual([]);
    expect(kits[0].managed).toBeUndefined();
  });

  it('says nothing about an installed kit the manifest never mentioned', () => {
    // every npm project: a manifest that objected would be a second
    // dependency file competing with package.json
    const root = project({ '.markout/kits.json': manifest({}) });
    install(root, 'node_modules', 'a-kit', '1.0.0');
    expect(discoverKits(path.join(root, 'site')).errors).toEqual([]);
  });

  it('reports a broken manifest through discovery, not just through the reader', () => {
    const root = project({ '.markout/kits.json': manifest({ 'a-kit': 'latest' }) });
    expect(discoverKits(path.join(root, 'site')).errors[0]).toContain(
      'not an exact version'
    );
  });
});
