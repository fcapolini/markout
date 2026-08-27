import fs from 'fs';
import os from 'os';
import path from 'path';
import { readManifest } from '@markout-lang/core';
import { afterEach, describe, expect, it } from 'vitest';
import { manifestDirFor, writeGitignore, writeManifest } from '../../src/kits/manifest';

/**
 * Creating and updating a project's `.markout`.
 *
 * The writing half, tested where it lives. Core's twin covers reading, and
 * the round trip below is what holds the two together across the package
 * boundary: the reader is the compiler's and the writer is the installer's,
 * so a test that only checked the bytes would not notice them drifting. See
 * docs/design/without-node.md.
 */

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()!;
    fs.existsSync(dir) && fs.rmSync(dir, { recursive: true, force: true });
  }
});

function temp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-manifest-'));
  temps.push(dir);
  return dir;
}

describe('writeManifest', () => {
  it('writes sorted, with a trailing newline, and a .gitignore beside it', () => {
    const root = temp();
    const file = writeManifest(root, { kits: { 'z-kit': '1.0.0', 'a-kit': '2.0.0' } });
    const text = fs.readFileSync(file, 'utf8');
    // sorted so a commit shows the kit that changed, not a Map's order
    expect(text.indexOf('a-kit')).toBeLessThan(text.indexOf('z-kit'));
    expect(text.endsWith('\n')).toBe(true);
    const ignore = fs.readFileSync(path.join(root, '.markout', '.gitignore'), 'utf8');
    expect(ignore).toContain('kits/');
    expect(ignore).toContain('cache/');
  });

  it('round-trips through the reader in core', () => {
    // the assertion the split is held to: the writer is this package's and
    // the reader is the compiler's, and they agree about the format
    const root = temp();
    writeManifest(root, { kits: { 'a-kit': '1.0.0' } });
    expect(readManifest(root).manifest.kits).toEqual({ 'a-kit': '1.0.0' });
    expect(readManifest(root).errors).toEqual([]);
  });

  it('carries through a key it has never heard of', () => {
    // what makes a split reader and writer safe: core may add a field to
    // `Manifest` without this package learning about it first
    const root = temp();
    fs.mkdirSync(path.join(root, '.markout'));
    const file = path.join(root, '.markout', 'kits.json');
    fs.writeFileSync(file, JSON.stringify({ kits: {}, somethingLater: 42 }));
    const read = readManifest(root).manifest as Record<string, unknown>;
    writeManifest(root, { ...read, kits: { 'a-kit': '1.0.0' } } as never);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).somethingLater).toBe(42);
  });
});

describe('writeGitignore', () => {
  it('leaves one somebody edited alone', () => {
    // deleting the `kits/` line is how a project opts into committing its
    // kits; putting it back on the next install would be a tool arguing
    const root = temp();
    fs.mkdirSync(path.join(root, '.markout'));
    fs.writeFileSync(path.join(root, '.markout', '.gitignore'), 'cache/\n');
    writeGitignore(root);
    expect(fs.readFileSync(path.join(root, '.markout', '.gitignore'), 'utf8')).toBe(
      'cache/\n'
    );
  });
});

describe('manifestDirFor', () => {
  it('prefers a .markout that already exists', () => {
    // moving one nobody asked to move is never right
    const root = temp();
    const docroot = path.join(root, 'site');
    fs.mkdirSync(docroot);
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.mkdirSync(path.join(docroot, '.markout'));
    expect(manifestDirFor(docroot)).toBe(docroot);
  });

  it('falls back to the nearest package.json', () => {
    const root = temp();
    const docroot = path.join(root, 'site');
    fs.mkdirSync(docroot);
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    expect(manifestDirFor(docroot)).toBe(root);
  });

  it('falls back to the docroot itself', () => {
    // the bare-docroot case this whole feature exists for: HTML in a
    // directory, and that directory is the project
    const root = temp();
    const docroot = path.join(root, 'site');
    fs.mkdirSync(docroot);
    expect(manifestDirFor(docroot)).toBe(docroot);
  });
});
