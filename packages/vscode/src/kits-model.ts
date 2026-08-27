import fs from 'fs';
import path from 'path';
import { discoverKits, findManifest, KITS_DIR, type Kit } from '@markout-lang/core';
import { DOCROOT_DIR_NAME, isMarkoutProject } from './diagnostics';
import { pagesUnder } from './pages';

/**
 * What the sidebar shows, with no VS Code in it.
 *
 * Kept free of any editor type for the reason `diagnostics.ts` is: what is
 * hard here is deciding what a row MEANS -- installed by whom, removable by
 * whom, out of date or deliberately not -- and none of that is easier to
 * think about through a TreeDataProvider. See docs/design/without-node.md.
 */

/** one row: a kit the project has, asked for, or is being offered */
export interface KitRow {
  name: string;
  /** the version on disk, if it is installed */
  installed?: string;
  /** the version `.markout/kits.json` pins, if it is declared */
  pinned?: string;
  description?: string;
  /**
   * Whether the sidebar may remove it.
   *
   * False for a kit npm installed: `package.json` and a lockfile own that
   * one, and a checkbox that silently edited somebody's `node_modules` would
   * be a sidebar reaching outside the thing it manages. Shown, because it is
   * genuinely installed and a user looking for it should find it -- with the
   * checkbox locked on and a tooltip saying who owns it.
   */
  managed: boolean;
  /** a newer version the registry has, when one has been looked up */
  available?: string;
  /** it is declared and not installed: the restore case */
  missing?: boolean;
}

export interface ProjectKits {
  /** the directory holding `.markout`, i.e. where an install would go */
  dir: string;
  rows: KitRow[];
  /** discovery's own refusals, worth showing where the user can act on them */
  errors: string[];
}

/**
 * Every kit this project has, asked for, or is offered, as rows.
 *
 * Three sources, merged by name and in this order of authority:
 *
 * 1. **Installed** -- what `discoverKits` found, which is the same answer the
 *    compiler, the build and CI get. A row that says "installed" here says it
 *    because the compiler agrees, not because a manifest claimed it.
 * 2. **Declared** -- `.markout/kits.json`. A declared kit that is not
 *    installed is the restore case, and is the whole reason the manifest
 *    exists: it is the only way the sidebar can know a kit is MISSING rather
 *    than merely absent.
 * 3. **Offered** -- this project's own kits, so an empty project has
 *    something to tick rather than a search box and no idea what to type.
 *    Passed in rather than read here: it comes from the registry, and this
 *    function answers about a directory and does no I/O beyond it.
 *
 * A kit discovery REFUSED is offered by none of them. It is installed --
 * that is why there is something to refuse -- so presenting it as absent
 * invites a tick that would fetch a second copy and fix nothing. The
 * refusal is already a row of its own, and is the only thing worth saying
 * about that kit.
 */
export function projectKits(
  docroot: string,
  dir: string,
  offered: { name: string; description?: string }[] = []
): ProjectKits {
  const found = discoverKits(docroot);
  const declared = findManifest(docroot)?.manifest.kits ?? {};
  const rows = new Map<string, KitRow>();

  for (const kit of found.kits) {
    rows.set(kit.name, {
      name: kit.name,
      installed: kit.version,
      pinned: declared[kit.name],
      managed: !!kit.managed,
      description: descriptionOf(kit),
    });
  }
  for (const [name, version] of Object.entries(declared)) {
    if (!rows.has(name)) {
      rows.set(name, { name, pinned: version, managed: true, missing: true });
    }
  }
  const refused = new Set(refusedKits(found.errors));
  for (const kit of offered) {
    if (!rows.has(kit.name) && !refused.has(kit.name)) {
      rows.set(kit.name, { name: kit.name, managed: true, description: kit.description });
    }
  }
  return {
    dir,
    // installed first, then declared-and-missing, then the rest; alphabetical
    // within each, so a row does not move because a version changed
    rows: [...rows.values()].sort(
      (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)
    ),
    errors: found.errors,
  };
}

/**
 * The packages discovery named in a refusal.
 *
 * Read out of the message, which is the only place discovery says it: a
 * `Discovery` carries errors as sentences, deliberately, so that a log and a
 * build report can print them unchanged. Both spellings are covered -- a
 * refusal is about a "kit" when it declared a root and a "package" when that
 * is what it failed to do.
 *
 * Degrades honestly if a message is ever reworded: the name stops being
 * extracted, the kit is offered again, and the worst outcome is the row that
 * was there before this existed.
 */
export function refusedKits(errors: string[]): string[] {
  return [
    ...new Set(
      errors.flatMap(e => [...e.matchAll(/(?:kit|package) "([^"]+)"/g)].map(m => m[1]))
    ),
  ];
}

/**
 * A discovery message with the absolute paths in it made relative.
 *
 * The messages are written for a terminal, where an absolute path is the
 * useful thing to print. A sidebar is perhaps forty characters wide, and the
 * paths are most of the length -- one refusal read
 * `...but the docroot already has "/Users/…/fixture/markout/bootstrap-kit"`,
 * of which the reader could see about half.
 *
 * The full text still goes in the tooltip. Nothing is lost, and the row says
 * which kit and why.
 */
export function shortenPaths(message: string, ...roots: string[]): string {
  let out = message;
  for (const root of roots.filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = out.split(root + path.sep).join('').split(root).join('.');
  }
  return out;
}

function rank(row: KitRow): number {
  return row.installed ? 0 : row.missing ? 1 : 2;
}

/** a kit's own `description`, for a row that has nothing else to say */
function descriptionOf(kit: Kit): string | undefined {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(kit.dir, 'package.json'), 'utf8'));
    return typeof json.description === 'string' ? json.description : undefined;
  } catch {
    return;
  }
}

/**
 * A bump worth offering: a newer version, not already declined.
 *
 * Declined is remembered PER VERSION rather than as a flag, so declining
 * 0.5.0 stops the offer for 0.5.0 and not for 0.6.0. A flag would turn one
 * "not now" into "never ask again", which is not what anybody means by it.
 */
export function isBumpPending(row: KitRow, declined: Record<string, string>): boolean {
  if (!row.installed || !row.available || row.available === row.installed) {
    return false;
  }
  if (!isNewer(row.available, row.installed)) {
    return false;
  }
  const no = declined[row.name];
  return !no || isNewer(row.available, no);
}

/** how many offers are waiting, which is what the activity bar badge counts */
export function pendingBumps(rows: KitRow[], declined: Record<string, string>): number {
  return rows.filter(row => isBumpPending(row, declined)).length;
}

/**
 * Whether `a` is a later version than `b`.
 *
 * Numeric by segment, and a prerelease loses to the release it precedes --
 * enough of semver to order two versions of one package, which is the only
 * comparison this makes. Anything more would be a resolver, and the manifest
 * pins exact versions precisely so that there is nothing to resolve.
 */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const [core, pre] = v.split('-', 2);
    return { nums: core.split('.').map(n => parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) {
      return d > 0;
    }
  }
  if (x.pre === y.pre) {
    return false;
  }
  // 1.0.0 beats 1.0.0-beta.1; between two prereleases, string order is as
  // good an answer as this needs
  return !x.pre || (!!y.pre && x.pre > y.pre);
}

/**
 * The pages that would break if this kit went away.
 *
 * A TEXT scan rather than a compile, and deliberately so: this answers a
 * refusal, not a diagnostic, and the honest failure mode for a refusal is to
 * find a page that turns out not to need the kit -- the user reads the list
 * and decides -- rather than to miss one and remove the kit out from under it.
 *
 * Both spellings of a kit's files are looked for, because both are how a page
 * reaches one: `/npm/<name>/...` names the package, `<root>/...` names the
 * mount. A kit whose tags a page uses without importing anything cannot exist
 * -- an import is what puts the definitions in scope -- so the two strings
 * are the whole surface.
 */
export function pagesUsing(docroot: string, kit: { name: string; root?: string }): string[] {
  const needles = [`/npm/${kit.name}`];
  kit.root && needles.push(kit.root + '/', `"${kit.root}"`, `'${kit.root}'`);
  const using: string[] = [];
  for (const page of pagesUnder(docroot)) {
    let text: string;
    try {
      text = fs.readFileSync(page, 'utf8');
    } catch {
      continue;
    }
    if (needles.some(needle => text.includes(needle))) {
      using.push(path.relative(docroot, page));
    }
  }
  return using;
}

/**
 * The docroot this window is about, or nothing.
 *
 * Searched DOWNWARD, which is the whole of what makes this different from
 * `docrootFor`. That answers "which docroot does this file belong to" by
 * walking up from the file, and every caller of it has a file: a diagnostic,
 * a completion, a hover. This has a FOLDER and no file, and the docroot it
 * is looking for is usually inside it -- `<folder>/markout`, the convention
 * that exists so a project needs no configuration. Walking up from an
 * invented path at the folder root can only ever answer with the folder.
 *
 * Candidates in order, first one that looks like a markout project winning:
 * whatever `markout.docroot` names, because it was said explicitly; then the
 * conventional directory; then the folder itself, for a project whose pages
 * are simply in it.
 *
 * One project, not several. A multi-root workspace has as many docroots as
 * folders, and a single list of checkboxes cannot honestly represent two
 * projects that disagree, so the first folder that answers wins -- right for
 * the case this is for, somebody with one folder of HTML open, and wrong
 * quietly rather than loudly for the rest.
 */
export function findDocroot(
  folders: string[],
  configured: string | string[] | undefined
): string | undefined {
  const named = Array.isArray(configured) ? configured : configured ? [configured] : [];
  for (const folder of folders) {
    const candidates = [
      ...named.map(d => path.resolve(folder, d)),
      path.join(folder, DOCROOT_DIR_NAME),
      folder,
    ];
    for (const candidate of candidates) {
      if (!fs.existsSync(candidate)) {
        continue;
      }
      // the same two questions the compiler asks: does this look like a
      // markout project, or has it a manifest saying which kits it wants
      if (isMarkoutProject(candidate) || findManifest(candidate)) {
        return candidate;
      }
    }
  }
  return;
}

/** where a managed kit's files are, for a removal that has to delete them */
export function managedKitDir(dir: string, name: string): string {
  return path.join(dir, ...KITS_DIR.split('/'), ...name.split('/'));
}
