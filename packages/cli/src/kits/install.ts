import fs from 'fs';
import path from 'path';
import { KITS_DIR, readManifest, type Manifest } from '@markout-lang/core';
import { manifestDirFor, writeManifest } from './manifest';
import { fetchTarball, resolveKit, type KitVersion } from './registry';
import { untar } from './untar';

/**
 * Installing a kit without npm.
 *
 * The terminal half of the sidebar's checkbox, and it exists so that the two
 * halves cannot drift: a project the sidebar produced has to be buildable by
 * somebody who has only a terminal, or it is a project only the sidebar can
 * build. That includes CI, which is the case that makes this not optional --
 * a clone carries `kits.json` and not `kits/`, and something has to fill it.
 *
 * Here rather than in core, which stays the compiler: fetching a tarball over
 * HTTPS, checking a hash and unpacking an archive is infrastructure, and none
 * of it is anything compiling a page does. What core keeps is the FILE
 * FORMAT -- `.markout/kits.json` is read by the compiler to report a kit the
 * project asked for and has not got, and its reader and writer belong
 * together so they cannot disagree about the format.
 *
 * The sidebar reaches this through `@markout-lang/cli/kits`, a subpath that
 * exports these functions and nothing else -- so the editor gets the
 * installer without the `markout` command, its server or its argument
 * parser. See packages/vscode/test/dependencies.test.ts, which asserts it.
 *
 * For people who HAVE npm this is the wrong tool and the reference says so:
 * `npm i @markout-lang/bootstrap-kit` puts the kit somewhere discovery
 * already looks, with a lockfile and a dependency resolver behind it. Two
 * ways to install a kit is a cost, and it is paid once in the docs rather
 * than repeatedly by people choosing between them.
 */

export interface InstallReport {
  /** what changed, one line each, already phrased for a console */
  installed: string[];
  /** what was already right */
  unchanged: string[];
  /** what went wrong, one line each; nothing was written for these */
  errors: string[];
  /** the manifest file, once there is one */
  manifest?: string;
  /** whether this run WROTE that file; `restore` reads it and never writes */
  pinned?: boolean;
}

/** `name`, `name@1.2.3` or `@scope/name@1.2.3` */
export function parseSpec(spec: string): { name: string; version: string } {
  const at = spec.lastIndexOf('@');
  if (at <= 0) {
    return { name: spec, version: 'latest' };
  }
  return { name: spec.substring(0, at), version: spec.substring(at + 1) || 'latest' };
}

/**
 * Fetch `specs` into the project `docroot` belongs to, and pin what arrived.
 *
 * The manifest is written AFTER the files are on disk, and only for the kits
 * that got there. A pin for a kit that failed to download would be a manifest
 * describing a project that has never existed, which is the one thing it is
 * for -- and `markout restore` would then fail forever on a line nobody
 * chose to add.
 */
export async function addKits(docroot: string, specs: string[]): Promise<InstallReport> {
  const dir = manifestDirFor(docroot);
  const report: InstallReport = { installed: [], unchanged: [], errors: [] };
  const pins = { ...readManifest(dir).manifest.kits };
  for (const spec of specs) {
    const { name, version } = parseSpec(spec);
    try {
      const resolved = await install(dir, name, version);
      pins[name] = resolved.version;
      report.installed.push(`${name}@${resolved.version}`);
    } catch (e) {
      report.errors.push(`${name}: ${(e as Error).message}`);
    }
  }
  // Only when something arrived. A manifest written after every spec failed
  // would be an empty file describing a project nobody asked for, and a
  // `.gitignore` beside it for a directory that does not exist.
  if (report.installed.length) {
    report.manifest = writeManifest(dir, { kits: pins } satisfies Manifest);
    report.pinned = true;
  }
  return report;
}

/**
 * Bring `.markout/kits/` to what the manifest asks for.
 *
 * The command a clone runs, and the one CI runs. It fetches only what is
 * missing or at the wrong version, so running it twice costs one manifest
 * read -- which matters because the honest thing for a CI script to do is run
 * it unconditionally.
 *
 * It does not remove a kit the manifest stopped naming. Removal is somebody
 * deciding to remove something, and a command whose job is "make this tree
 * match" is the wrong place to discover that a directory was deleted.
 */
export async function restoreKits(docroot: string): Promise<InstallReport> {
  const dir = manifestDirFor(docroot);
  const found = readManifest(dir);
  const report: InstallReport = {
    installed: [],
    unchanged: [],
    errors: [...found.errors],
    manifest: found.file,
  };
  const declared = Object.entries(found.manifest.kits);
  if (!declared.length && !report.errors.length) {
    report.errors.push(
      fs.existsSync(found.file)
        ? `"${found.file}" asks for no kits`
        : `no "${found.file}" -- run "markout add <kit>" to start one`
    );
    return report;
  }
  for (const [name, version] of declared) {
    if (installedVersion(dir, name) === version) {
      report.unchanged.push(`${name}@${version}`);
      continue;
    }
    try {
      await install(dir, name, version);
      report.installed.push(`${name}@${version}`);
    } catch (e) {
      report.errors.push(`${name}: ${(e as Error).message}`);
    }
  }
  return report;
}

/**
 * One kit into `<dir>/.markout/kits/<name>`, replacing whatever was there.
 *
 * Unpacked BESIDE the destination and moved into place, so that a download
 * that fails halfway leaves the previous copy intact. A kit that half exists
 * is worse than one that does not: discovery would find it, mount it, and
 * report its missing files as an author's mistake.
 */
async function install(dir: string, name: string, version: string): Promise<KitVersion> {
  const resolved = await resolveKit(name, version);
  // Refused BEFORE anything is downloaded. A package that is not a kit
  // declares no root, so there is nowhere to mount it and nothing about
  // installing it would work -- and `markout add express` is a mistake worth
  // catching with a sentence rather than with a silent no-op later.
  if (!resolved.root) {
    throw new Error(
      `"${name}@${resolved.version}" is not a kit -- its package.json ` +
        `declares no "markout.root", so nothing would mount it`
    );
  }
  const bytes = await fetchTarball(resolved);
  const into = path.join(dir, ...KITS_DIR.split('/'), ...name.split('/'));
  const staging = `${into}.${process.pid}.tmp`;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    untar(bytes, staging);
    if (!fs.existsSync(path.join(staging, 'package.json'))) {
      throw new Error(`the tarball for "${name}@${resolved.version}" holds no package.json`);
    }
    fs.mkdirSync(path.dirname(into), { recursive: true });
    fs.rmSync(into, { recursive: true, force: true });
    fs.renameSync(staging, into);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return resolved;
}

/** the version installed in `.markout/kits`, if any */
function installedVersion(dir: string, name: string): string | undefined {
  try {
    const file = path.join(dir, ...KITS_DIR.split('/'), ...name.split('/'), 'package.json');
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string };
    return json.version;
  } catch {
    return;
  }
}
