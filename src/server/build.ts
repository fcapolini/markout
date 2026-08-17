import fs from 'fs';
import path from 'path';
import { Compiler } from '../compiler';
import { DEFAULT_RUNTIME_SRC } from '../compiler/stages/stage7-generate';
import type { PageError } from '../html/parser';
import type { RuntimeError } from '../runtime/core/core-context';
import { renderPage } from './render';
import { loadClientCode, RUNTIME_BUNDLE_PATH } from './runtime-bundle';

/**
 * The dot-prefixed names a build copies, out of the many it skips.
 *
 * An ALLOW-list rather than a rule reversed, because the two kinds of dotfile
 * are different in kind rather than in degree. What belongs in a deployable is
 * a closed, standardised set: `.well-known` is specified (RFC 8615) for exactly
 * this -- ACME challenges, `security.txt`, `assetlinks.json` -- and the other
 * two are a host's marker and a host's config. What must never be published is
 * open-ended and gets a new member with every tool anyone installs: `.env`,
 * `.git`, `.DS_Store`, `.gitignore`, `.vscode`.
 *
 * Default-deny with three exceptions gets both right, and keeps the worst
 * outcome available -- a `.env` copied into a public bucket -- impossible. A
 * deny-list over the other set would be guesswork, which is the same reason
 * this build does not try to guess which extensions are "source".
 *
 * Matched by name at any depth, since `.htaccess` is meaningful per directory.
 */
const SERVABLE_DOTFILES = new Set([
  '.well-known', // RFC 8615: the standard place for things that must be public
  '.nojekyll', // GitHub Pages: publish this directory as-is
  '.htaccess', // Apache per-directory config for the deployed tree
]);

export interface BuildProps {
  /** where the sources are */
  docroot: string;
  /** where to write pages, the runtime, and everything else */
  outdir: string;
  /**
   * Restrict the build to these pages, docroot-relative. Empty or absent
   * builds every `.html` under the docroot.
   *
   * A restricted build still writes the runtime -- a page without it is not a
   * page -- but does NOT copy assets. It is the "rebuild this one page" tool,
   * and copying the whole tree again is the part nobody wanted repeated.
   */
  pages?: string[];
  /** `src` the built pages use for the runtime; defaults to DEFAULT_RUNTIME_SRC */
  runtimeSrc?: string;
}

export interface BuildResult {
  /** pages written, as docroot-relative pathnames */
  pages: string[];
  /** everything copied across unchanged */
  assets: string[];
  /** where the runtime landed, docroot-relative */
  runtime: string;
  /**
   * Compile errors, with the page each came from. Non-empty means the build
   * FAILED: the pages it names were not written.
   */
  errors: { pathname: string; error: PageError }[];
  /**
   * Ordinary expressions that threw while rendering. The page was still
   * written, on the same grounds the server keeps serving one: the browser
   * re-derives these, so a value that was asked too early here is a hole that
   * fills itself rather than a reason to have no page.
   */
  runtimeErrors: { pathname: string; error: RuntimeError }[];
  /**
   * `:server-` values that failed, which is a different matter and FAILS the
   * build: such a value crosses to the browser frozen, with a result and no
   * expression, so nothing re-runs it. Whatever it failed to produce, the page
   * is without for as long as it exists.
   *
   * The page is not written either. Everything else here is refused before
   * anything is output, and a page that cannot have its data is no more
   * deliverable than one that would not compile.
   */
  serverErrors: { pathname: string; error: RuntimeError }[];
}

/**
 * Compile a docroot ahead of time into files a plain static host can serve.
 *
 * The same render that the middleware runs per request, run once per page at
 * build time instead -- so the output carries its markup rather than waiting
 * for the browser to produce it. See docs/concepts/rendering.md.
 *
 * What it cannot carry is what a request would have supplied, and a
 * `:server-` value is where that shows: there is no request here, so no
 * `$origin` and none of the host's globals. Such a value failing FAILS the
 * build (see BuildResult.serverErrors) rather than being reported and shipped,
 * because it crosses to the browser frozen and nothing re-runs it.
 *
 * Deliberately not a compile-time refusal of `:server-` values as such. Two
 * reasons: one that reads nothing of the request works perfectly well here and
 * is worth having -- fetching an absolute URL at build time and baking the
 * answer into the page is what static site generation IS -- and whether a
 * given value needs a request is decided at runtime anyway. `std-data` is the
 * example: the same `:server-` value is inert or a fetch depending on
 * `:client`, so no static check can tell those apart, while the render can.
 */
export async function build(props: BuildProps): Promise<BuildResult> {
  const docroot = path.resolve(props.docroot);
  const outdir = path.resolve(props.outdir);

  // Both directions, and both for the same reason: one of them would compile
  // its own output on the second run, and the other would write over the
  // sources it is reading. Cheaper to refuse than to explain afterwards.
  if (contains(docroot, outdir)) {
    throw new Error(
      `markout: output directory "${outdir}" is inside the docroot -- ` +
        `the next build would compile its own output`
    );
  }
  if (contains(outdir, docroot)) {
    throw new Error(
      `markout: docroot "${docroot}" is inside the output directory "${outdir}"`
    );
  }

  const clientCode = loadClientCode();
  if (!clientCode) {
    // fatal here, unlike in the server: output is written once and then read
    // by somebody who was not watching this console
    throw new Error(
      `markout: runtime bundle not found at "${RUNTIME_BUNDLE_PATH}" -- ` +
        `run "npm run build:runtime"`
    );
  }

  const runtimeSrc = props.runtimeSrc ?? DEFAULT_RUNTIME_SRC;
  const compiler = new Compiler({ docroot, runtimeSrc });
  const result: BuildResult = {
    pages: [],
    assets: [],
    runtime: runtimeSrc,
    errors: [],
    runtimeErrors: [],
    serverErrors: [],
  };

  const restricted = !!props.pages?.length;
  const found = restricted
    ? { pages: props.pages!.map(pagePathname), assets: [] }
    : await walk(docroot);

  // The runtime is written and then the assets are copied over it, so a
  // docroot with a file of this name silently replaced the runtime and the
  // build said it had succeeded -- every page in the output broken, by the one
  // file nobody would think to suspect.
  //
  // Refused rather than resolved either way round, because both orders are
  // wrong: writing the runtime last discards the author's file instead, just
  // as quietly. Case-insensitively, since the output may well land on a
  // filesystem that does not distinguish the two.
  const clash = found.assets.find(
    a => a.toLowerCase() === runtimeSrc.toLowerCase()
  );
  if (clash) {
    throw new Error(
      `markout: "${clash}" in the docroot has the same name as the runtime ` +
        `this build writes -- rename it, or pass a different runtimeSrc`
    );
  }

  // one at a time: a render writes into the page's own document and reads it
  // back out as text, which is the same reason the middleware gives each page
  // a turn of its own rather than overlapping them
  for (const pathname of found.pages) {
    const page = await compiler.compile(pathname);
    if (page.errors.length) {
      page.errors.forEach(error => result.errors.push({ pathname, error }));
      continue;
    }
    const errors = await renderPage(page);
    const fatal = errors.filter(e => e.serverOnly);
    fatal.forEach(error => result.serverErrors.push({ pathname, error }));
    errors
      .filter(e => !e.serverOnly)
      .forEach(error => result.runtimeErrors.push({ pathname, error }));
    if (fatal.length) {
      continue;
    }
    await write(outdir, pathname, '<!doctype html>\n' + page.source.doc.toString());
    result.pages.push(pathname);
  }

  await write(outdir, runtimeSrc, clientCode);
  for (const pathname of found.assets) {
    await copy(docroot, outdir, pathname);
    result.assets.push(pathname);
  }

  return result;
}

/**
 * How a page named on the command line is spelled internally.
 *
 * `Compiler.compile` takes a docroot-relative pathname with a leading slash,
 * and half of anyone typing one will leave it off -- so both are accepted, as
 * is an extensionless name, which is what the server resolves for a request.
 */
export function pagePathname(name: string): string {
  let pathname = name.replace(/\\/g, '/');
  pathname.startsWith('/') || (pathname = '/' + pathname);
  path.posix.extname(pathname) || (pathname += '.html');
  return pathname;
}

/**
 * Every page and every asset under the docroot.
 *
 * `.html` is a page and `.htm` is a fragment, which is the distinction the
 * server already draws by refusing to serve the second -- so a fragment is
 * not copied either. Its content reaches the output inlined into the pages
 * that imported it, and shipping the source alongside would publish a file
 * the served mode answers 404 for.
 *
 * Dot-prefixed names are skipped for the same reason the middleware refuses
 * them -- except the few whose whole purpose is to be served, see
 * SERVABLE_DOTFILES -- and `node_modules` because a docroot of `.` in a project
 * root should not produce a build measured in gigabytes.
 *
 * Symlinks are FOLLOWED, which is not a detail: `kits/bootstrap/std-kit` is a
 * link to the std kit next door, and a directory entry that is a link is
 * neither a file nor a directory to `readdir` -- so treating the dirent's word
 * as final copied a directory as though it were a file. Resolved paths are
 * remembered because following links is how a walk finds its way into a cycle.
 */
async function walk(docroot: string): Promise<{ pages: string[]; assets: string[] }> {
  const pages: string[] = [];
  const assets: string[] = [];
  const seen = new Set<string>();
  const visit = async (dir: string) => {
    const real = await fs.promises.realpath(dir);
    if (seen.has(real)) {
      return;
    }
    seen.add(real);
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const hidden = entry.name.startsWith('.') && !SERVABLE_DOTFILES.has(entry.name);
      if (hidden || entry.name === 'node_modules') {
        continue;
      }
      const full = path.join(dir, entry.name);
      // stat rather than the dirent for a link, so that what it POINTS AT
      // decides -- and a broken one is skipped rather than fatal, since a
      // dangling link in a docroot is not this command's business
      const stats = entry.isSymbolicLink()
        ? await fs.promises.stat(full).catch(() => null)
        : entry;
      if (!stats) {
        continue;
      }
      if (stats.isDirectory()) {
        await visit(full);
        continue;
      }
      const pathname = '/' + path.relative(docroot, full).split(path.sep).join('/');
      const ext = path.posix.extname(pathname).toLowerCase();
      if (ext === '.html') {
        pages.push(pathname);
      } else if (ext !== '.htm') {
        assets.push(pathname);
      }
    }
  };
  await visit(docroot);
  return { pages: pages.sort(), assets: assets.sort() };
}

/** whether `inner` is `outer` or sits below it */
function contains(outer: string, inner: string): boolean {
  const rel = path.relative(outer, inner);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function write(outdir: string, pathname: string, text: string) {
  const target = path.join(outdir, pathname);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, text, 'utf8');
}

async function copy(docroot: string, outdir: string, pathname: string) {
  const target = path.join(outdir, pathname);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.copyFile(path.join(docroot, pathname), target);
}
