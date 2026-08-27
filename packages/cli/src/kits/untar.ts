import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

/**
 * Enough of tar to unpack an npm tarball, and no more.
 *
 * Written here rather than depended on because the alternative is a
 * dependency tree in a tool whose whole argument is that it needs no
 * toolchain -- and because a tarball is a very simple format: 512-byte
 * headers, 512-byte-aligned payloads, and a name field. `zlib` is built in.
 * See docs/design/without-node.md, which rejects bundling npm for the same
 * reason.
 *
 * What it deliberately does NOT do is as important as what it does. This code
 * writes files to disk from bytes fetched over the network, so every entry
 * that is not a plain file or a directory is SKIPPED rather than interpreted:
 * a symlink, a hard link, a device node and a tar extension header are all
 * things an archive can ask for that a kit has no use for, and each is a way
 * to write outside the directory the caller named.
 */

/** a tar header block: 512 bytes, fields at fixed offsets, NUL-padded */
const BLOCK = 512;

export interface UntarResult {
  /** files written, as paths relative to `into` */
  files: string[];
  /** entries skipped and why, for a caller that wants to say so */
  skipped: string[];
}

/**
 * Unpack a gzipped tar into `into`, dropping `strip` leading path segments.
 *
 * npm puts everything under `package/`, so `strip` is 1 for a tarball from
 * the registry: the caller names the directory the kit should occupy and
 * gets exactly that, rather than a `package` directory inside it.
 */
export function untar(tgz: Buffer, into: string, strip = 1): UntarResult {
  const tar = zlib.gunzipSync(tgz);
  const files: string[] = [];
  const skipped: string[] = [];
  const root = path.resolve(into);
  let offset = 0;
  // a POSIX archive ends with two zero blocks; a truncated one just runs out
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every(b => b === 0)) {
      break;
    }
    const name = str(header, 0, 100);
    const size = octal(header, 124, 12);
    // ustar splits a long name across a prefix field; GNU tar uses a
    // pseudo-entry instead, which the type check below skips
    const prefix = str(header, 345, 155);
    const typeflag = String.fromCharCode(header[156] || 0x30);
    offset += BLOCK;
    const payload = tar.subarray(offset, offset + size);
    offset += Math.ceil(size / BLOCK) * BLOCK;

    const full = prefix ? `${prefix}/${name}` : name;
    // '0' and '\0' are a plain file; '5' is a directory. Everything else --
    // links, devices, GNU long names, pax headers -- is a thing a kit does
    // not need and an archive could use to write somewhere else
    if (typeflag !== '0' && typeflag !== '\0' && typeflag !== '5') {
      skipped.push(`${full} (tar type "${typeflag}")`);
      continue;
    }
    const rest = full.split('/').filter(s => s && s !== '.').slice(strip);
    if (!rest.length) {
      continue;
    }
    // Refused rather than normalized. `..` inside an archive is how a tarball
    // writes outside the directory it was told to occupy, and there is no
    // reading of it that a kit wants.
    if (rest.some(s => s === '..')) {
      skipped.push(`${full} (path escapes the destination)`);
      continue;
    }
    const target = path.join(root, ...rest);
    // belt and braces: the segment check above has already refused every
    // escape, so this can only fire for a name that means something to the
    // platform that it does not mean here
    if (target !== root && !target.startsWith(root + path.sep)) {
      skipped.push(`${full} (path escapes the destination)`);
      continue;
    }
    if (typeflag === '5') {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, payload);
    files.push(rest.join('/'));
  }
  return { files, skipped };
}

/** a NUL-terminated field, as text */
function str(block: Buffer, at: number, length: number): string {
  const raw = block.subarray(at, at + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end < 0 ? raw.length : end).toString('utf8').trim();
}

/** a tar numeric field: octal digits, space- or NUL-terminated */
function octal(block: Buffer, at: number, length: number): number {
  const text = str(block, at, length).replace(/[^0-7]/g, '');
  return text ? parseInt(text, 8) : 0;
}
