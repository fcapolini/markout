import fs from 'fs';
import path from 'path';
import {
  allowedPageKits,
  Compiler,
  contains,
  DEFAULT_RUNTIME_SRC,
  discoverKits,
  loadClientCode,
  renderPage,
  Resolver,
  RUNTIME_BUNDLE_PATH,
  walkTree,
  type Kit,
  type PageError,
  type RuntimeError,
} from '@markout/core';

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
  /**
   * Installed kits. Absent means discover them from the docroot, which is
   * what the CLI wants; passing an explicit list (`[]` included) is for a
   * caller that has already scanned, or a test that wants neither.
   */
  kits?: Kit[];
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
  /**
   * Kits refused before anything was compiled -- a root claimed twice, a
   * root the docroot already occupies, a malformed declaration. FAILS the
   * build, and nothing is written: every page that imported such a kit would
   * be missing it, and every page that did not would still be built against
   * a URL space with a hole in it.
   */
  kitErrors: string[];
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

  // Discovered from what is INSTALLED rather than from what some page
  // imported, which is the same rule the middleware follows -- so the two
  // cannot disagree about whether a kit's resource exists. See docs/design/npm-kits.md.
  const discovered = props.kits ? { kits: props.kits, errors: [] } : discoverKits(docroot);
  const runtimeSrc = props.runtimeSrc ?? DEFAULT_RUNTIME_SRC;
  const compiler = new Compiler({ docroot, runtimeSrc, kits: discovered.kits });
  const resolver = new Resolver(docroot, discovered.kits);
  const result: BuildResult = {
    pages: [],
    assets: [],
    runtime: runtimeSrc,
    errors: [],
    runtimeErrors: [],
    serverErrors: [],
    kitErrors: discovered.errors,
  };
  if (discovered.errors.length) {
    return result;
  }

  const restricted = !!props.pages?.length;
  const found = restricted
    ? { pages: props.pages!.map(pagePathname), assets: [] }
    : await collect(docroot, discovered.kits, resolver);

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
    // through the resolver, so an asset under a kit's root is copied out of
    // the package while one under the docroot is copied out of the docroot,
    // by the same line
    const at = resolver.resolve(pathname);
    if (!at.ok) {
      continue;
    }
    await copy(at.filePath, path.join(outdir, pathname));
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
 * Every page and every asset the build is responsible for, as LOGICAL
 * pathnames -- the docroot's own, plus each kit's under the root it declares.
 *
 * A kit contributes its resources unconditionally, on the same terms as a
 * directory of the same name in the docroot. Its PAGES are contributed only
 * where a docroot page said `allow-pages` on the import -- the one place
 * this design departs from "as though the kit were symlinked in", and it
 * departs because a kit's broken page would otherwise fail a build belonging
 * to somebody who cannot edit it. See ./publish.
 *
 * Worth knowing rather than discovering: a kit shipping sources still puts
 * them in the output, exactly as a docroot holding them does. `build` reports
 * the extensions it copied rather than a count for that reason, and what a
 * kit ships is decided by npm's own `files`/`.npmignore` rather than by
 * anything here.
 */
async function collect(
  docroot: string,
  kits: Kit[],
  resolver: Resolver
): Promise<{ pages: string[]; assets: string[] }> {
  const found = await walkTree(docroot);
  const allowed = await allowedPageKits(docroot, resolver);
  for (const kit of kits) {
    const at = await walkTree(kit.dir).catch(() => ({ pages: [], assets: [] }));
    found.assets.push(...at.assets.map(a => kit.root + a));
    if (allowed.has(kit.root)) {
      found.pages.push(...at.pages.map(p => kit.root + p));
    }
  }
  return { pages: found.pages.sort(), assets: found.assets.sort() };
}

async function write(outdir: string, pathname: string, text: string) {
  const target = path.join(outdir, pathname);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, text, 'utf8');
}

async function copy(from: string, target: string) {
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.copyFile(from, target);
}
