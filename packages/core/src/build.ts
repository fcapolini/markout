import fs from 'fs';
import path from 'path';
import { Compiler } from './compiler';
import { URL_GLOBAL } from './runtime/core/core-global';
import { discoverKits, type Kit } from './kits';
import { contains, Resolver } from './paths';
import { allowedPageKits, walkTree } from './publish';
import { renderPage } from './render/render';
import { DEFAULT_RUNTIME_SRC } from './compiler/stages/stage7-generate';
import {
  loadClientCode,
  runtimeBundlePath,
  runtimeSrcFor,
} from './render/runtime-bundle';
import { PageError } from './html/parser';
import type { Page } from './compiler/ir/Page';
import type { RuntimeError } from './runtime/core/core-context';

/**
 * Ahead-of-time delivery: one build, then plain files on any host.
 *
 * In core rather than beside the `markout build` command, which is the shape
 * this ends up in for the same reason `render.ts` did: a build is a compile
 * and a render and nothing else -- there is no HTTP in it, and its whole
 * audience is people who cannot run Node in the request path. Keeping it in
 * the CLI made it reachable only through a package whose main entry pulls a
 * web server, which put it out of reach of the one other caller that wants
 * it: the editor's Build button. See docs/design/without-node.md.
 */

export interface BuildProps {
  /** where the sources are */
  docroot: string;
  /** where to write pages, the runtime, and everything else */
  outdir: string;
  /**
   * Write a `.gitignore` into the output directory, ignoring all of it.
   *
   * For an outdir this tool CHOSE, and not one the caller named. `markout
   * build ./site ./public` is somebody putting the output where they want it,
   * possibly to commit it -- a static host serving a folder out of the
   * repository is exactly the deployment this audience uses -- and quietly
   * making that folder invisible to git would be a surprise found long after
   * the build. The default `dist/` beside the docroot is markout's own
   * suggestion, so markout can tidy up after it.
   *
   * Written once and never rewritten, like `.markout/.gitignore`: deleting it
   * is how somebody says they meant to commit the build, and a tool that put
   * it back would be arguing.
   */
  gitignore?: boolean;
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
   * Where the runtime bundle is, for a host that repackages this code and
   * so breaks the walk from core's own directory -- see runtimeBundlePath.
   *
   * A parameter rather than the environment variable that does the same
   * job, because a host setting one on its own process leaks it into every
   * terminal it opens. Told here, it reaches this build and nothing else.
   */
  runtimeBundle?: string;
  /**
   * Drop an installed kit's files when no page in this build mentions its
   * root. Off by default, and opt-in on purpose -- see pruneKits().
   */
  pruneKits?: boolean;
  /**
   * Installed kits. Absent means discover them from the docroot, which is
   * what the CLI wants; passing an explicit list (`[]` included) is for a
   * caller that has already scanned, or a test that wants neither.
   */
  kits?: Kit[];
  /**
   * The origin these pages are being built FOR, as `$origin`.
   *
   * A build has no request, so by default a page has no origin -- and a
   * `:server-` fetch of `/data.json` is then not an address at all, which
   * `std-data` refuses rather than renders blank. That refusal is right when
   * nothing can answer, and wrong when something can: a docroot whose data
   * sits in it as files (Orbit's `demos/orbit/api/`) is fetchable the moment
   * anything is serving that directory.
   *
   * So this is supplied rather than guessed. Point it at a server for the
   * same docroot -- `markout <docroot>` in another terminal is one -- and
   * relative sources resolve exactly as they do when served, which is what
   * makes such a page buildable at all.
   *
   * Not the deploy host, though it may be the same thing: what this affects
   * is where the BUILD fetches from. A page that renders `$origin` into its
   * markup will carry whatever is passed here, which is a reason to pass the
   * address the pages are going to live at when both are available.
   */
  origin?: string;
  /**
   * Run each page's render before writing it.
   *
   * Off by default, and that default is the whole distinction between the two
   * commands. `markout build` compiles: directives become a props object and a
   * runtime link, and every value is resolved in the browser, the way any
   * client-side framework does it. `markout prerender` additionally runs the
   * render here, resolving values and writing their results into the markup,
   * which is what makes a page arrive with its content already in it.
   *
   * The reason this is a choice and not a default is `origin` above. A render
   * performs a page's `:server-` fetches, so pre-rendering a page whose data
   * comes from a backend requires that backend reachable FROM THE BUILD --
   * unbuildable without it, not merely unrendered -- and bakes that moment's
   * answer into the artifact. Neither is a thing a compile step should do
   * without being asked.
   */
  prerender?: boolean;
  /**
   * Append a `<template>` to every built page naming the classes its
   * `:class-` toggles can put on it, so a CSS generator reading the output
   * finds them -- see docs/design/tailwind-support.md.
   *
   * For a project that DEPLOYS this output: the manifest travels with the
   * page, so pointing Tailwind at `dist/**` is the whole configuration. A
   * project serving its sources from Node wants `classesOnly` instead, which
   * puts the same names in one throwaway file and ships nothing.
   */
  classManifest?: boolean;
  /**
   * Say what built the pages: `<meta name="generator" content="Markout 0.4.0">`,
   * appended to a page's `<head>` unless it already names a generator.
   *
   * On by default. A built site is where this matters most -- it is the
   * copy that goes somewhere nobody here will ever hear about -- and also
   * the one whose bytes someone may want to account for exactly.
   */
  generator?: boolean;
  /**
   * Write ONLY the class manifest -- one file, no pages, no assets, no
   * runtime -- and skip rendering entirely.
   *
   * This is the served-mode half of the same feature. A page served by Node
   * is compiled per request and never lands on disk, so a CSS generator has
   * nothing to scan; this produces the scan target in one pass over the
   * docroot, deterministically, without the browsing-history dependence a
   * server that wrote its own output would have.
   *
   * Rendering is skipped because the answer does not depend on it: what
   * classes a page can wear is fixed at compile time, which is also why
   * serving per request needs nothing further. It makes this much faster than
   * a build -- there is no settle loop and no datasource to wait for.
   */
  classesOnly?: boolean;
}

/** what `classesOnly` writes, relative to the output directory */
export const CLASSES_MANIFEST_FILE = '_classes.html';

export interface BuildResult {
  /** pages written, as docroot-relative pathnames */
  pages: string[];
  /** everything copied across unchanged */
  assets: string[];
  /** where the runtime landed, docroot-relative */
  runtime: string;
  /**
   * Class names the pages' `:class-` toggles can apply, sorted and merged
   * across every page built. Present when `classManifest` or `classesOnly`
   * asked for them.
   */
  classes?: string[];
  /**
   * Kit roots dropped by `pruneKits`, sorted. Present only when the flag was
   * passed, and `[]` when it was passed and nothing was dropped -- so the
   * caller can say which of the two happened.
   *
   * Reported rather than merely done: a build quietly shipping less than the
   * one before it is how a missing file becomes a 404 nobody connects to a
   * flag they set months ago.
   */
  prunedKits?: string[];
  /**
   * Compile errors, with the page each came from. Non-empty means the build
   * FAILED: the pages it names were not written.
   */
  errors: { pathname: string; error: PageError }[];
  /**
   * What the compiler had to say about pages that built anyway.
   *
   * Kept apart from `errors` because the difference is the whole point: a
   * warning is a judgment about a page, and a build that stopped for one --
   * or exited non-zero -- would make it an error under another name.
   */
  warnings: { pathname: string; error: PageError }[];
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
  /**
   * Copies of a kit a nearer one stands in front of, at a different version.
   * Said, and not counted against the build -- picking the nearer copy is the
   * rule rather than a failure of it. See `discoverKits`.
   */
  kitShadowed: string[];
}

/**
 * Compile a docroot ahead of time into files a plain static host can serve.
 *
 * The same render that the middleware runs per request, run once per page at
 * build time instead -- so the output carries its markup rather than waiting
 * for the browser to produce it. See docs/concepts/isomorphism.md.
 *
 * What it cannot carry is what a request would have supplied, and a
 * `:server-` value is where that shows: there is no request here, so no
 * `$origin` unless one is passed (see BuildProps.origin) and none of the
 * host's globals. Such a value failing FAILS the build (see
 * BuildResult.serverErrors) rather than being reported and shipped, because
 * it crosses to the browser frozen and nothing re-runs it.
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

  props.gitignore && ignoreOutput(outdir);

  // not needed by a manifest-only run, which writes no page to load it
  const clientCode = props.classesOnly ? '' : loadClientCode(props.runtimeBundle);
  if (!props.classesOnly && !clientCode) {
    // fatal here, unlike in the server: output is written once and then read
    // by somebody who was not watching this console
    throw new Error(
      `markout: runtime bundle not found at "${runtimeBundlePath(props.runtimeBundle)}" -- ` +
        `run "npm run build:runtime"`
    );
  }

  // Discovered from what is INSTALLED rather than from what some page
  // imported, which is the same rule the middleware follows -- so the two
  // cannot disagree about whether a kit's resource exists. See docs/design/npm-kits.md.
  const discovered = props.kits
    ? { kits: props.kits, errors: [], shadowed: [] }
    : discoverKits(docroot, [__dirname]);
  // content-hashed, so the built pages point at a URL that can only ever
  // mean these bytes -- which is what lets a host cache it forever, and what
  // keeps a page from finding a runtime it was not compiled against. Nothing
  // to hash when there is no bundle, which is `--classes-only`
  const runtimeSrc =
    props.runtimeSrc ?? (clientCode ? runtimeSrcFor(clientCode) : DEFAULT_RUNTIME_SRC);
  const compiler = new Compiler({
    docroot,
    runtimeSrc,
    kits: discovered.kits,
    classManifest: props.classManifest,
    generator: props.generator,
  });
  const resolver = new Resolver(docroot, discovered.kits);
  const result: BuildResult = {
    pages: [],
    assets: [],
    runtime: runtimeSrc,
    errors: [],
    warnings: [],
    runtimeErrors: [],
    serverErrors: [],
    kitErrors: discovered.errors,
    kitShadowed: discovered.shadowed,
  };
  if (discovered.errors.length) {
    return result;
  }

  const restricted = !!props.pages?.length;
  /** kit roots some built page mentioned; only filled when pruning */
  const referenced = new Set<string>();
  const found = restricted
    ? { pages: props.pages!.map(pagePathname), assets: [] }
    : await collect(docroot, discovered.kits, resolver);

  if (props.classesOnly) {
    const names = new Set<string>();
    for (const pathname of found.pages) {
      const page = await compiler.compile(pathname);
      collectDiagnostics(result, pathname, page);
      if (page.hasErrors) continue;
      page.classNames().forEach(name => names.add(name));
    }
    result.classes = [...names].sort();
    result.runtime = '';
    // A compile error means the page it names contributed nothing, so the
    // manifest is short by however many toggles it held -- and a short
    // manifest is exactly the silent failure this feature exists to prevent.
    // Write nothing rather than something incomplete.
    if (!result.errors.length) {
      await write(outdir, CLASSES_MANIFEST_FILE, manifestFile(result.classes));
    }
    return result;
  }

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
    collectDiagnostics(result, pathname, page);
    if (page.hasErrors) continue;
    if (props.prerender) {
      // the address this page will answer at, which a build knows once it
      // has been told the origin: `$url` is that, and `$origin` comes out
      // of it. Without one there is no address to speak of, and both are
      // undefined -- see BuildProps.origin
      !props.origin && readsUrl(page) && result.warnings.push({
        pathname,
        error: new PageError(
          'warning',
          `this page reads $url and there is no address to read: nothing ` +
            `was passed to --origin, so $url is undefined here and whatever ` +
            `the page derives from it renders as the no-address case. Pass ` +
            `--origin <url> to say where these pages will live`,
          undefined
        ),
      });
      const errors = await renderPage(page, {
        origin: props.origin,
        url: props.origin ? `${props.origin}${pathname}` : undefined,
      });
      const fatal = errors.filter(e => e.serverOnly);
      fatal.forEach(error => result.serverErrors.push({ pathname, error }));
      errors
        .filter(e => !e.serverOnly)
        .forEach(error => result.runtimeErrors.push({ pathname, error }));
      if (fatal.length) {
        continue;
      }
    }
    const text = page.source.doc.toString();
    await write(outdir, pathname, '<!doctype html>\n' + text);
    result.pages.push(pathname);
    // what this page MENTIONS, which is not what it imported: a page naming
    // `/bootstrap-kit/res/logo.png` and importing nothing still needs the
    // kit's files. Read off the written output for that reason -- and note the
    // evidence is weaker without a prerender, since a url a value would have
    // produced is not in the text yet. The flag is opt-in for someone who
    // knows their pages do not build urls at runtime; without a prerender that
    // is a stronger thing to know.
    if (props.pruneKits) {
      for (const kit of discovered.kits) {
        text.includes(kit.root) && referenced.add(kit.root);
      }
    }
    if (props.classManifest) {
      const all = new Set(result.classes ?? []);
      page.classNames().forEach(name => all.add(name));
      result.classes = [...all].sort();
    }
  }

  await write(outdir, runtimeSrc, clientCode);
  const assets = props.pruneKits
    ? pruneKits(found.assets, discovered.kits, referenced, result, restricted)
    : found.assets;
  for (const pathname of assets) {
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
 * The manifest as a file a scanner will read.
 *
 * Deliberately plain: a CSS generator looks for candidate strings in raw
 * text, so a `class` attribute holding literals is all this has to be. Not a
 * whole document, and not JSON -- a scanner would find nothing to extract
 * from the latter, which is the entire point of choosing this shape.
 */
function manifestFile(classes: string[]): string {
  return (
    '<!-- Generated by "markout build --classes-only". Do not edit.\n' +
    '     Every class the docroot\'s pages can apply through a `:class-`\n' +
    '     toggle, which a CSS generator cannot see in the source: the\n' +
    '     utility is spelled in the attribute NAME there.\n' +
    '     Point your scanner at this file. See docs/design/tailwind-support.md. -->\n' +
    `<div class="${classes.join(' ')}"></div>\n`
  );
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

/**
 * Drops the files of an installed kit that no page in this build mentions.
 *
 * Off by default and opt-in, because the rule it bends is the one the whole
 * kit design is arranged around: the server's mount table and the build's
 * output BOTH derive from what is installed, never from what was imported,
 * so dev and the deliverable cannot disagree about whether a kit's resource
 * exists. See docs/design/npm-kits.md, which committed to this being a flag
 * for exactly that reason.
 *
 * So the test is **reference, not import**, and that difference is the point.
 * A page writing `<img src="/bootstrap-kit/res/logo.png">` without importing
 * anything needs those files, and import-derived pruning is the trap the rule
 * exists to close -- it would work in dev and 404 once built. What is read
 * here is the rendered output of every page, which is the last thing that
 * knows what a page actually asks for.
 *
 * Conservative wherever it cannot see the whole picture, and each of these is
 * a way to be wrong quietly rather than a special case:
 *
 * - a page that failed to compile contributed no output, so its references
 *   are unknown and NOTHING is pruned -- the same call `--classes-only`
 *   makes when it would otherwise write a manifest short by a page's worth
 * - a restricted build (`--page`) never saw the other pages, and their
 *   references are equally unknown
 * - a kit contributing PAGES was named by a docroot page's `allow-pages`, so
 *   it is kept whether or not its root appears in any output
 * - a string match, so a mention in a comment or in prose keeps the kit. Err
 *   toward keeping: the cost of a wrong keep is two metadata files, and the
 *   cost of a wrong drop is a 404 in the deliverable
 *
 * A URL a page builds at runtime is the case this cannot see, and the reason
 * the flag belongs to the person who knows their pages do not do that.
 */
function pruneKits(
  assets: string[],
  kits: Kit[],
  referenced: Set<string>,
  result: BuildResult,
  restricted: boolean
): string[] {
  result.prunedKits = [];
  if (result.errors.length || restricted) {
    return assets;
  }
  const pages = new Set(result.pages);
  const drop = kits
    .filter(kit => !referenced.has(kit.root))
    // a kit whose own pages were built was allowed in by name
    .filter(kit => ![...pages].some(p => p.startsWith(kit.root + '/')))
    .map(kit => kit.root);
  if (!drop.length) {
    return assets;
  }
  result.prunedKits = [...drop].sort();
  return assets.filter(a => !drop.some(root => a.startsWith(root + '/')));
}

/**
 * `<outdir>/.gitignore`, ignoring everything including itself.
 *
 * Nested rather than a line added to the project's own `.gitignore`, for the
 * reason `.markout/` is: git honours one at any depth, so the directory says
 * which of its contents are disposable without a file the project owns being
 * edited, and without anybody having to know the answer.
 *
 * `*` covers the file too, which is what is wanted: nothing here is worth
 * committing, this file included, and a build makes all of it again.
 */
function ignoreOutput(outdir: string) {
  const file = path.join(outdir, '.gitignore');
  if (fs.existsSync(file)) {
    return;
  }
  fs.mkdirSync(outdir, { recursive: true });
  fs.writeFileSync(
    file,
    [
      '# Written by markout build. Everything here is generated from the',
      '# docroot and is made again by the next build, this file included.',
      '#',
      '# Delete it if you mean to commit the output.',
      '*',
      '',
    ].join('\n')
  );
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

/**
 * Sorts what a compile had to say into what stops the build and what does not.
 *
 * One place, because the two callers below both used to write the same line
 * and a warning reaching `errors` would fail a build for something the
 * compiler deliberately declined to fail on.
 */
/**
 * Whether anything on this page depends on `$url`.
 *
 * Asked of the compiled props rather than of the source, because that is
 * what will actually run: `$url` is the one global the compiler emits a
 * dependency for, so a page that reads it says so there and a page that
 * merely mentions it in a comment does not.
 *
 * The distinction it CANNOT make is guarded from unguarded -- `$url.hash`
 * and `$url?.hash` compile to the same dependency, since `?.` on a member
 * is not a crossing between scopes. Which is why the warning says what the
 * page will render rather than that it will fail: for a guarded page the
 * answer is "the no-address branch", and that is worth knowing too.
 */
function readsUrl(page: Page): boolean {
  const data = page.props?.data;
  if (!data) return false;
  type ScopeJson = {
    values?: { [key: string]: { deps?: unknown[][] } };
    usageValues?: { [key: string]: { deps?: unknown[][] } };
    children?: ScopeJson[];
  };
  const named = (values?: { [key: string]: { deps?: unknown[][] } }) =>
    Object.values(values ?? {}).some(v =>
      (v.deps ?? []).some(dep => dep.length === 1 && dep[0] === URL_GLOBAL)
    );
  const walk = (scope: ScopeJson): boolean =>
    named(scope.values) ||
    named(scope.usageValues) ||
    (scope.children ?? []).some(walk);
  try {
    return walk(JSON.parse(data) as ScopeJson);
  } catch {
    return false;
  }
}

function collectDiagnostics(
  result: { errors: { pathname: string; error: PageError }[];
            warnings: { pathname: string; error: PageError }[] },
  pathname: string,
  page: { errors: PageError[] }
): void {
  for (const error of page.errors) {
    (error.type === 'warning' ? result.warnings : result.errors).push({ pathname, error });
  }
}
