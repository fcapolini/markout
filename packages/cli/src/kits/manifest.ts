import fs from 'fs';
import path from 'path';
import { findManifest, MANIFEST_FILE, MARKOUT_DIR, type Manifest } from '@markout-lang/core';

/**
 * Creating and updating a project's `.markout`.
 *
 * The writing half of core's [manifest.ts](../../../core/src/manifest.ts),
 * which keeps the format and the reader. The split is the line this package
 * boundary is drawn on: **core describes a project, the CLI changes one.**
 * Compiling a page has to know what the project asked for, so the reader is
 * the compiler's; nothing about compiling creates a directory or writes a
 * `.gitignore`, so this is not.
 *
 * The two cannot drift over the FORMAT, which is the thing a split reader and
 * writer would usually risk. `Manifest` is core's type and `writeManifest`
 * takes one; between them the reader carries every key it did not understand
 * into the object, and the writer puts them back -- so a read, an edit to
 * `kits` and a write leaves a field this code has never heard of exactly as
 * it found it. Writing the round-trip test is what showed the reader was
 * dropping them, which would have made an old tool silently delete a new
 * tool's settings.
 */

/**
 * Where a project's `.markout` should go, for something about to create one.
 *
 * Beside the installer rather than in core, because only an installer asks:
 * nothing in the compiler creates a `.markout`, and a function core exported
 * for callers outside it is one core did not need. The SIDEBAR has to answer
 * it the same way the terminal does -- two halves of one feature that
 * disagreed about where the manifest lives would produce a project each could
 * see half of -- and both reach it here.
 *
 * The nearest existing `.markout` wins, since moving one nobody asked to move
 * is never right. Failing that, the nearest `package.json` -- a project root
 * is where a project's own files go, and that file is what marks one. Failing
 * BOTH, the docroot itself, which is the bare-docroot case this whole feature
 * exists for: HTML in a directory, and that directory is the project.
 *
 * `stopAt` bounds the walk, and the editor passes the workspace folder: a
 * project is not something to go looking for OUTSIDE the folder somebody
 * opened. Without it, a docroot in a folder that happens to sit inside a
 * larger repository installs kits into that repository -- which the fixture
 * in this repo demonstrated by wanting to write into the extension's own
 * package. The CLI passes nothing, having no such boundary: you run it from
 * the project.
 */
export function manifestDirFor(docroot: string, stopAt?: string): string {
  const root = path.resolve(docroot);
  const stop = stopAt ? path.resolve(stopAt) : undefined;
  const found = findManifest(docroot);
  if (found && (!stop || within(stop, found.dir))) {
    return found.dir;
  }
  let current = root;
  for (;;) {
    if (fs.existsSync(path.join(current, MARKOUT_DIR))) {
      return current;
    }
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current || current === stop) {
      return root;
    }
    current = parent;
  }
}

/** whether `dir` is `boundary` or inside it */
function within(boundary: string, dir: string): boolean {
  const rel = path.relative(boundary, dir);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Write `manifest` into `dir`, creating `.markout` and its `.gitignore`.
 *
 * Sorted by name, and with a trailing newline: this file is committed and
 * will be diffed, and a diff of a manifest should show the kit that changed
 * rather than the order a Map happened to be in.
 */
export function writeManifest(dir: string, manifest: Manifest): string {
  const file = path.join(dir, ...MANIFEST_FILE.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const kits: Record<string, string> = {};
  for (const name of Object.keys(manifest.kits).sort()) {
    kits[name] = manifest.kits[name];
  }
  fs.writeFileSync(file, JSON.stringify({ ...manifest, kits }, null, 2) + '\n');
  writeGitignore(dir);
  return file;
}

/**
 * `.markout/.gitignore`, ignoring everything a fetch can reproduce.
 *
 * Nested rather than a line appended to the root `.gitignore`: git honours
 * one at any depth, so the directory documents which half of itself is
 * disposable without editing a file the project owns and without the author
 * needing to know the answer.
 *
 * Written once and never rewritten. A project that wants the zero-install
 * property deletes the `kits/` line and commits the directory, and having
 * `markout add` put it back on the next install would be a tool arguing with
 * a decision.
 */
export function writeGitignore(dir: string): void {
  const file = path.join(dir, MARKOUT_DIR, '.gitignore');
  if (fs.existsSync(file)) {
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      '# Written by markout. Everything here can be fetched again from',
      '# kits.json, which is the half worth committing.',
      '#',
      '# Delete the `kits/` line and commit the directory to get a project',
      '# that needs no install at all: kits are .htm and CSS, they diff, and',
      '# there is no build step behind them.',
      'kits/',
      'cache/',
      '',
    ].join('\n')
  );
}
