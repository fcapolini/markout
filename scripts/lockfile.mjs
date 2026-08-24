/**
 * Puts back the platform entries `npm install` takes out of the lockfile.
 *
 * npm 11 rewrites package-lock.json to describe what is INSTALLED, and what
 * is installed on one machine is that machine's platform. So an ordinary
 * `npm install` here deletes every `@esbuild/*` entry but this one's, and
 * the lockfile stops being the artifact `npm ci` is for. Measured on this
 * repository: 26 platform entries down to zero, held from 2026-06 to
 * 2026-08 without anything going red, because npm resolves an optional
 * platform package at install time even when the lockfile does not pin it.
 * Nothing broke here; the failure that eventually comes of it lands on
 * whoever is not on a Mac.
 *
 * **No npm flag prevents it.** `--package-lock-only`, `--force` and even
 * `--os=linux --cpu=x64` prune identically, because the pruning follows from
 * the tree on disk rather than from the request -- which is also why
 * deleting the lockfile does not help: with node_modules still there, npm
 * describes that. Seeding a clean copy with the pruned lockfile does not
 * help either; npm honours it and leaves the platforms out.
 *
 * What works is a resolve with neither: no lockfile to trim and no tree to
 * describe, npm asks the registry what a dependency offers and records all
 * of it.
 *
 * **And then only the missing entries are copied across**, rather than the
 * whole file. A from-scratch resolve also re-resolves every transitive
 * dependency to whatever its range allows today -- run against this
 * repository it moved four unrelated nested packages -- so taking the fresh
 * lockfile wholesale would make "repair the lockfile" a dependency update
 * wearing a repair's clothes. That is the sort of thing this project files
 * issues about, so it does not do it: the fresh resolve is a donor, and each
 * transplanted entry has to be for the version the existing lockfile already
 * asked for or it is refused and reported.
 *
 * Safe to do by hand because these are leaves. A platform package has no
 * dependencies of its own and nothing refers to it except the
 * `optionalDependencies` of its owner, which already names it at exactly
 * this version.
 *
 *     npm run lockfile
 *
 * Run it after any `npm install` that changed dependencies.
 * test/lockfile-platforms.test.ts is what tells you when you forgot.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(root, 'package-lock.json');

/** `owner -> dep` for every optional dependency the lockfile does not describe */
function missingFrom(packages) {
  const missing = [];
  for (const [name, entry] of Object.entries(packages)) {
    for (const [dep, spec] of Object.entries(entry.optionalDependencies ?? {})) {
      const nested = `${name}/node_modules/${dep}`;
      if (!(nested in packages) && !(`node_modules/${dep}` in packages)) {
        missing.push({ owner: name, dep, spec });
      }
    }
  }
  return missing;
}

/** every package.json this resolve depends on: the root's and the workspaces' */
function manifests() {
  const rootManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const found = ['package.json'];
  for (const pattern of rootManifest.workspaces ?? []) {
    // the only shape used here, and asserted rather than parsed: `dir/*`
    const dir = pattern.replace(/\/\*$/, '');
    if (dir === pattern) {
      throw new Error(`unsupported workspace pattern "${pattern}"`);
    }
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name, 'package.json');
      entry.isDirectory() && fs.existsSync(path.join(root, rel)) && found.push(rel);
    }
  }
  return found;
}

/** a lockfile resolved from the manifests alone, with every platform in it */
function donor() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-lockfile-'));
  try {
    const files = manifests();
    for (const rel of files) {
      fs.mkdirSync(path.join(work, path.dirname(rel)), { recursive: true });
      fs.copyFileSync(path.join(root, rel), path.join(work, rel));
    }
    console.log(`resolving ${files.length} manifest(s) with no tree to describe...`);
    execFileSync('npm', ['install', '--package-lock-only'], {
      cwd: work,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    return JSON.parse(fs.readFileSync(path.join(work, 'package-lock.json'), 'utf8')).packages;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const missing = missingFrom(lock.packages);
if (!missing.length) {
  console.log('package-lock.json describes every optional dependency already');
  process.exit(0);
}
console.log(`${missing.length} optional dependenc(ies) missing from package-lock.json`);

const fresh = donor();
const added = [];
const refused = [];
for (const { owner, dep, spec } of missing) {
  const entry = fresh[`node_modules/${dep}`];
  if (!entry) {
    refused.push(`${dep}: the fresh resolve has no entry for it either`);
  } else if (entry.version !== spec) {
    // the guard that keeps this a repair. `optionalDependencies` on a
    // platform package set is pinned exactly, so anything but an exact match
    // means the donor resolved a different version of the owner and its
    // entry describes bytes this lockfile never asked for
    refused.push(`${dep}: donor has ${entry.version}, ${owner} asks for ${spec}`);
  } else {
    added.push({ owner, dep, entry: transplant(entry, lock.packages[owner]) });
  }
}

/**
 * The donor's entry with this tree's flags on it.
 *
 * `dev`, `optional` and `peer` do not describe the package -- they describe
 * how it is reached HERE -- and the donor reached it through a tree resolved
 * a moment ago from ranges alone, which is not necessarily this one. Copying
 * them across imports a fact about the wrong tree: caught by the first
 * version of this doing exactly that, adding `"peer": true` to all 26
 * because esbuild is a peer somewhere in the donor and a plain devDependency
 * here.
 *
 * So the registry facts come from the donor and the position comes from the
 * owner that declares it, plus `optional`, which it is by definition -- this
 * entry exists because something listed it under `optionalDependencies`.
 */
function transplant(entry, owner) {
  const want = { dev: !!owner?.dev, optional: true, peer: !!owner?.peer };
  const out = {};
  for (const [key, value] of Object.entries(entry)) {
    // Rebuilt by walking the donor's own keys and DROPPING what this tree
    // does not want, never by adding: npm writes the fields of an entry in
    // an order of its own, and re-adding a flag at the end moves three lines
    // per entry for no reason. Caught the same way as the flags themselves
    // were -- by a diff that should have been empty and was 78 lines.
    key in want ? want[key] && (out[key] = true) : (out[key] = value);
  }
  const absent = Object.keys(want).filter(k => want[k] && !(k in out));
  if (absent.length) {
    // has not happened, and if it does the honest answer is to say so rather
    // than guess where npm would have put it
    throw new Error(`donor entry has no ${absent.join(', ')} to keep`);
  }
  return out;
}

// Inserted where npm itself would put them, which is `localeCompare` order
// among the `node_modules/*` keys -- checked rather than assumed: sorting
// this lockfile's 634 of them that way reproduces it exactly, where a plain
// sort disagrees in one place (`string_decoder` before `string-width`).
//
// Key order is not semantic, and the first version of this put each entry
// beside the package that declares it on the theory that a grouped diff
// reads better. It produced a 4,444-line one, because moving the block out
// of its sorted position rewrites everything after it. Landing them back
// where they were is a diff of just the entries.
const keys = Object.keys(lock.packages);
for (const a of added) {
  const key = `node_modules/${a.dep}`;
  const at = keys.findIndex(k => k.startsWith('node_modules/') && k.localeCompare(key) > 0);
  keys.splice(at < 0 ? keys.length : at, 0, key);
  lock.packages[key] = a.entry;
}
lock.packages = Object.fromEntries(keys.map(k => [k, lock.packages[k]]));
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');

console.log(`added ${added.length}: ${added.map(a => a.dep).join(' ')}`);
refused.length && console.warn(`refused ${refused.length}:\n  ${refused.join('\n  ')}`);
process.exitCode = refused.length ? 1 : 0;
