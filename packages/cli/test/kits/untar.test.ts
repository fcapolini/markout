import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { untar } from '../../src/kits/untar';

/**
 * The tar reader, and the entries it refuses.
 *
 * This code writes files to disk from bytes fetched over the network, so the
 * refusals are the substance: every test below is an archive asking to write
 * somewhere it was not invited. See docs/design/without-node.md.
 */

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()!;
    fs.existsSync(dir) && fs.rmSync(dir, { recursive: true, force: true });
  }
});

function temp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-untar-'));
  temps.push(dir);
  return dir;
}

/** one 512-byte ustar header, with the checksum tar readers do not require */
function header(name: string, size: number, typeflag = '0'): Buffer {
  const block = Buffer.alloc(512);
  block.write(name.substring(0, 100), 0, 'utf8');
  block.write('000644 \0', 100);
  block.write('000000 \0', 108);
  block.write('000000 \0', 116);
  block.write(size.toString(8).padStart(11, '0') + ' ', 124);
  block.write('00000000000 ', 136);
  block.write('        ', 148);
  block.write(typeflag, 156);
  block.write('ustar\0', 257);
  block.write('00', 263);
  const sum = block.reduce((a, b) => a + b, 0);
  block.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return block;
}

/** a gzipped tar of `entries`, as the registry would serve one */
function tarball(entries: { name: string; body?: string; type?: string }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '', 'utf8');
    blocks.push(header(entry.name, body.length, entry.type ?? '0'));
    if (body.length) {
      const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
      body.copy(padded);
      blocks.push(padded);
    }
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

describe('untar', () => {
  it('unpacks a package, dropping npm\'s leading directory', () => {
    const into = temp();
    const { files } = untar(
      tarball([
        { name: 'package/package.json', body: '{"name":"a-kit"}' },
        { name: 'package/parts/card.htm', body: '<div></div>' },
      ]),
      into
    );
    expect(files.sort()).toEqual(['package.json', 'parts/card.htm']);
    // the caller named the directory the kit occupies and got exactly that,
    // rather than a `package` directory inside it
    expect(fs.readFileSync(path.join(into, 'package.json'), 'utf8')).toBe('{"name":"a-kit"}');
    expect(fs.existsSync(path.join(into, 'package'))).toBe(false);
  });

  it('creates the directories an archive declares', () => {
    const into = temp();
    untar(tarball([{ name: 'package/res/', type: '5' }]), into);
    expect(fs.statSync(path.join(into, 'res')).isDirectory()).toBe(true);
  });

  it('refuses an entry that climbs out with ..', () => {
    const into = temp();
    const { files, skipped } = untar(
      tarball([
        { name: 'package/../../escaped.txt', body: 'no' },
        { name: 'package/kept.txt', body: 'yes' },
      ]),
      into
    );
    expect(files).toEqual(['kept.txt']);
    expect(skipped[0]).toContain('escapes the destination');
    expect(fs.existsSync(path.join(into, '..', '..', 'escaped.txt'))).toBe(false);
  });

  it('refuses an absolute entry', () => {
    const into = temp();
    // `/etc/x` strips to `etc/x` under the destination rather than landing at
    // the filesystem root -- the leading empty segment is dropped, and what
    // is left cannot escape
    const { files } = untar(tarball([{ name: '/etc/passwd', body: 'no' }]), into);
    expect(files).toEqual(['passwd']);
    expect(fs.existsSync(path.join(into, 'passwd'))).toBe(true);
  });

  it('skips a symlink rather than following it', () => {
    // a link is a way to write outside the destination on the NEXT write, and
    // a kit has no use for one
    const into = temp();
    const { files, skipped } = untar(
      tarball([
        { name: 'package/link', type: '2' },
        { name: 'package/real.txt', body: 'yes' },
      ]),
      into
    );
    expect(files).toEqual(['real.txt']);
    expect(skipped[0]).toContain('tar type "2"');
    expect(fs.existsSync(path.join(into, 'link'))).toBe(false);
  });

  it('skips a GNU long-name pseudo-entry instead of writing it as a file', () => {
    const into = temp();
    const { files } = untar(
      tarball([
        { name: '././@LongLink', body: 'package/whatever', type: 'L' },
        { name: 'package/real.txt', body: 'yes' },
      ]),
      into
    );
    expect(files).toEqual(['real.txt']);
  });

  it('stops at the end-of-archive blocks', () => {
    const into = temp();
    const bytes = Buffer.concat([
      zlib.gunzipSync(tarball([{ name: 'package/a.txt', body: 'a' }])),
      Buffer.from('trailing garbage that is not a header'),
    ]);
    expect(untar(zlib.gzipSync(bytes), into).files).toEqual(['a.txt']);
  });
});
