import { Compiler, discoverKits, type Kit, type Page, type ReadFile } from '@markout-lang/core';
import { globalNodeModules, globalNodeModulesVia } from './global-kits';
import fs from 'fs';
import path from 'path';

/**
 * Compiling, for an editor: the same compiler, asked far more often.
 *
 * One keystroke can ask for diagnostics, completion, a definition and a hover
 * against the identical buffer, and compiling Orbit costs about 125ms. So
 * answers are kept briefly -- long enough to serve that burst, short enough
 * that a change to an imported fragment shows up in the page that imports it
 * without anything having to know which files those are.
 *
 * A TTL rather than a dependency graph on purpose. The correct invalidation
 * is "any file this page read has changed", which the compiler can only tell
 * us AFTER compiling; a quarter of a second of staleness costs nothing that
 * a person can perceive and needs no bookkeeping that can be wrong.
 */

/** how long a compiled page is reused for */
const PAGE_TTL = 250;
/** how long the installed-kit scan is reused for; an npm install is rarer */
const KITS_TTL = 5000;

const pages = new Map<string, { at: number; page: Promise<Page> }>();
const kits = new Map<string, { at: number; found: Kit[] }>();
/** every kit report already made, so the rescan timer cannot repeat one */
const said = new Set<string>();

/** where a kit report goes; the server points this at its output channel */
export type KitReport = (level: 'info' | 'warn', message: string) => void;
let report: KitReport = () => {};

/** said by the server on startup; a no-op leaves the reports unspoken */
export function setKitReporter(fn: KitReport): void {
  report = fn;
}

export interface CompileProps {
  docroot: string;
  pathname: string;
  /** the text of the file itself, which is what a cache entry is keyed on */
  text: string;
  readFile?: ReadFile;
  /** the clock, so a test can be sure of what expiry does */
  now?: () => number;
}

export async function compilePage(props: CompileProps): Promise<Page | undefined> {
  const { docroot, pathname, text } = props;
  const now = props.now ?? Date.now;
  const key = `${docroot}\0${pathname}\0${text}`;
  const cached = pages.get(key);
  if (cached && now() - cached.at < PAGE_TTL) {
    return cached.page.catch(() => undefined);
  }
  const page = new Compiler({
    docroot,
    kits: kitsFor(docroot, now),
    readFile: props.readFile,
    // an editor wants what the page COULD use. Shaken, `customTags` holds
    // only the tags already typed, so a kit of thirty components offers the
    // three someone has got round to using
    treeshake: false,
  }).compile(pathname);
  pages.set(key, { at: now(), page });
  evict(pages, now());
  return page.catch(() => undefined);
}

/**
 * Compile a file the way it is USED: a page as itself, a fragment through a
 * page that imports it.
 *
 * Shared by everything that has to look at one file, because "what does a
 * fragment even compile as" is a question with one right answer and no
 * reason to have two.
 */
export async function compileFileFor(props: {
  docroot: string;
  pathname: string;
  text: string;
  open?: (filePath: string) => string | undefined;
}): Promise<{ page: Page; compiled: string } | undefined> {
  const { docroot, pathname } = props;
  const fragment = pathname.toLowerCase().endsWith('.htm');
  const compiled = fragment ? hostPageFor(docroot, pathname) ?? PROBE_PAGE : pathname;
  const self = path.join(docroot, pathname);
  const page = await compilePage({
    docroot,
    pathname: compiled,
    text: props.text,
    readFile: async filePath => {
      if (filePath.endsWith(PROBE_PAGE)) {
        return probeFor(pathname);
      }
      const buffer = filePath === self ? props.text : props.open?.(filePath);
      if (buffer !== undefined) {
        return buffer;
      }
      try {
        return await fs.promises.readFile(filePath, 'utf8');
      } catch {
        return undefined;
      }
    },
  });
  return page ? { page, compiled } : undefined;
}

/** the installed kits, scanned at most every few seconds */
export function kitsFor(docroot: string, now: () => number = Date.now): Kit[] {
  const cached = kits.get(docroot);
  if (cached && now() - cached.at < KITS_TTL) {
    return cached.found;
  }
  const global = globalNodeModules();
  const { kits: found, errors } = discoverKits(docroot, global ? [global] : []);
  kits.set(docroot, { at: now(), found });
  explain(docroot, found, errors, global);
  return found;
}

/**
 * Where this docroot's kits came from, or why there are none.
 *
 * An unresolved tag reads the same whichever way the kit went missing, and
 * the ways are not obvious: a project that has ANY kit of its own never
 * consults the global tree (see discoverKits -- deliberate, so a stray
 * global copy cannot break a real project), and a machine with two npms has
 * two global trees, only one of which holds what was installed. Both end in
 * "no such tag" with nothing said about the tree that was actually read.
 *
 * So the tree that was read is said out loud, once per distinct answer. It
 * goes to the output channel rather than the Problems panel: it is not a
 * fault in the page being edited, and it is only wanted by someone already
 * asking why their kit is missing. Refusals are the exception -- a kit that
 * was found and rejected is a misconfiguration whose only other symptom is
 * a page full of tags that do not resolve.
 */
function explain(docroot: string, found: Kit[], errors: string[], global: string | null) {
  for (const error of errors) {
    say('warn', error);
  }
  const fromGlobal = global ? found.filter(kit => kit.dir.startsWith(global)) : [];
  const local = found.length - fromGlobal.length;
  if (local > 0) {
    say(
      'info',
      `${docroot}: ${plural(local, 'kit')} from the project` +
        ` -- the global tree is read only when the project has none`
    );
  } else if (fromGlobal.length > 0) {
    say('info', `${docroot}: ${plural(fromGlobal.length, 'kit')} from ${global}`);
  } else if (global) {
    say(
      'info',
      `${docroot}: no kits -- none in the project, and none in ${global}` +
        `, which is where \`npm root -g\` points` +
        (globalNodeModulesVia() === 'shell' ? ' in your login shell' : ' on the PATH this process was given') +
        `. A second npm (Homebrew beside a version manager) has a second` +
        ` global tree, and a kit installed with one is invisible to the other`
    );
  } else {
    say(
      'info',
      `${docroot}: no kits -- none in the project, and npm could not be` +
        ` reached to locate the global tree. The login shell is being asked;` +
        ` globally installed kits will appear a few seconds from now if it answers`
    );
  }
}

function plural(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** once per distinct message: this runs on a timer, and a repeat says nothing new */
function say(level: 'info' | 'warn', message: string) {
  if (said.has(message)) {
    return;
  }
  said.add(message);
  report(level, message);
}

/** everything expired, plus the oldest if the map has run away */
function evict(map: Map<string, { at: number }>, at: number) {
  for (const [key, entry] of map) {
    if (at - entry.at >= PAGE_TTL) {
      map.delete(key);
    }
  }
  while (map.size > 16) {
    map.delete(map.keys().next().value as string);
  }
}

/** for tests: forget everything */
export function forgetPages() {
  pages.clear();
  kits.clear();
  said.clear();
}

/**
 * The pathname of a page that imports or includes `fragment`, if there is one.
 *
 * A fragment is not a page and cannot be checked as one. Most are
 * self-contained -- a file of `<:define>`s reads nothing from whoever imports
 * it, because a definition may not read its call site -- but not all: a
 * fragment written to be `<:include>`d is an INSTANCE, and instances resolve
 * names where they are written. Checking one of those on its own reports
 * every name its host supplies as unknown, which is worse than saying
 * nothing.
 *
 * So a host is looked for, by reading the docroot's pages and seeing which
 * names this file. Text rather than compilation: this runs to decide whether
 * to compile at all, and the answer only has to be a page that mentions it.
 */
export function hostPageFor(docroot: string, fragment: string): string | undefined {
  const wanted = [`"${fragment}"`, `'${fragment}'`];
  for (const file of pagesUnder(docroot)) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (wanted.some(w => text.includes(w))) {
      return '/' + path.relative(docroot, file).split(path.sep).join('/');
    }
  }
  return undefined;
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage']);

export function pagesUnder(dir: string, depth = 0): string[] {
  if (depth > 6) {
    return [];
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...pagesUnder(full, depth + 1));
    } else if (/\.html$/i.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * A page whose only job is to import a fragment, for when no real page does.
 *
 * Which is how a fragment is used, and the difference between a check that
 * works and one that reports `<:import> is only allowed directly in <head>`
 * on nearly every file in a component kit -- compiled on its own, a
 * fragment's own imports are not in a head, because it has no head.
 */
export const PROBE_PAGE = '/__markout-fragment__.html';

export function probeFor(fragment: string): string {
  return `<html><head><:import src="${fragment}" /></head><body></body></html>`;
}
