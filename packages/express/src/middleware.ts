import { NextFunction, Request, RequestHandler, Response } from "express";
import { randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import {
  allowedPageKits,
  Compiler,
  DEFAULT_RUNTIME_SRC,
  discoverKits,
  formatRuntimeError,
  loadClientCode,
  NPM_PREFIX,
  RUNTIME_CACHE_CONTROL,
  runtimeSrcFor,
  PageError,
  publishablePath,
  renderPage,
  Resolver,
  RuntimeError,
  type Kit,
  type Page,
} from "@markout-lang/core";
import { defaultLogger, MarkoutLogger } from "./logger";
import { createReloader, RELOAD_REQ, Reloader, withReloadScript } from "./livereload";
import { TreeWatcher, watchTree } from "./watcher";

/**
 * The path the runtime bundle is served at, as this middleware answers it.
 *
 * Content-hashed rather than fixed, which is what lets it be cached for a
 * year instead of revalidated on every visit -- see core's `runtimeSrcFor`.
 * Computed once per mount from the bundle it is about to serve, so the URL
 * a page asks for and the bytes behind it cannot come apart.
 *
 * `DEFAULT_RUNTIME_SRC` remains what the compiler falls back to when nobody
 * tells it otherwise, which is the case for a page compiled outside any
 * server. Here somebody does.
 */
export const CLIENT_CODE_REQ = DEFAULT_RUNTIME_SRC;

/** see handleNonPageRequests, and build.ts's SERVABLE_DOTFILES */
const WELL_KNOWN_PREFIX = '/.well-known/';

/**
 * The not-found page a docroot gets without asking. Deliberately the name
 * every static host already looks for, so the page is not something markout
 * invented a second convention for: a built docroot serves it because the
 * host does, and a served one serves it because of this.
 */
const DEFAULT_NOT_FOUND = '/404.html';

export interface MarkoutProps {
  docroot: string;
  /**
   * Surface runtime expression errors in the served page (and tell the
   * browser runtime to do the same after hydration). Off by default: outside
   * dev mode these are logged server-side and never reach the markup.
   *
   * Also turns on live reload -- pages hold a stream open and reload when the
   * compiled-page cache is invalidated, which is to say when the watcher sees
   * a change. Error pages carry it too, since that is where somebody is about
   * to fix the file. See ./livereload; none of it can reach a `build`.
   */
  dev?: boolean;
  logger?: MarkoutLogger;
  /**
   * Say what built the pages: `<meta name="generator" content="Markout 0.4.0">`,
   * appended to a page's `<head>` unless it already names a generator.
   *
   * On by default. Off is a supported answer for a deployment that would
   * rather not say, instead of a thing to strip out of the HTML afterwards.
   */
  generator?: boolean;
  /**
   * Objects the pages may reach from a `:server-` value -- a database
   * handle, a mailer, whatever this application has.
   *
   * They exist on the server and nowhere else, which is not a restriction
   * this imposes but a fact about where they live: nothing could ship a
   * database connection to a browser. The compiler is told their names and
   * enforces it, so reading one outside a `:server-` value is a build error
   * rather than a page that works in dev and is empty in production.
   *
   *   markout({ docroot, globals: { db: openDatabase() } })
   *
   * Their RESULTS still travel to the browser like any server value, so what
   * a page reads out of one is as public as the page is.
   */
  globals?: { [name: string]: unknown };
  /**
   * Installed kits. Absent means discover them from the docroot; an explicit
   * list (`[]` included) is for a caller that has already scanned, or a test
   * that wants neither.
   *
   * Discovered from what is INSTALLED and never from what a page imported,
   * because a request for `/bootstrap-kit/res/logo.png` has to resolve before
   * any page has been compiled. `build` follows the same rule, so the two
   * cannot disagree about whether a kit's resource exists. See docs/design/npm-kits.md.
   */
  kits?: Kit[];
  /**
   * What a visitor gets instead of a bare status line. See ErrorPages.
   */
  errorPages?: ErrorPages;
  /**
   * Serve the pages with a CSP nonce on every `<script>` markout injects --
   * the props, the transferred state, the runtime, and in dev the reload
   * script. Off by default, because a page that carries a nonce nobody put
   * in a policy is a page carrying a useless attribute.
   *
   * What this deliberately does NOT do is send the header. A framework that
   * writes your Content-Security-Policy gets it wrong for your application:
   * the policy has to cover your images, your styles, your analytics, none
   * of which markout knows about. But a framework that will not tell you its
   * nonce makes a strict policy impossible, since three of the scripts on
   * the page are ones you did not write. So it mints the nonce and hands it
   * back, and the policy stays yours:
   *
   *   app.use(cspNonce());          // mints it, BEFORE the header is written
   *   app.use((req, res, next) => {
   *     res.setHeader('Content-Security-Policy',
   *       `script-src 'nonce-${res.locals.markoutNonce}'`);
   *     next();
   *   });
   *   app.use(markout({ docroot, csp: true }));
   *
   * That order is not a style: markout ANSWERS a page request, so nothing
   * mounted after it runs, and a header therefore has to be written on the
   * way in -- by which time the nonce has to exist. `cspNonce()` is what
   * makes it exist that early; `true` mints one itself only when nothing
   * already has, so a page never carries a token its own policy never heard
   * of. Pass a function instead where the application already has one --
   * helmet mints `res.locals.cspNonce` -- so that one nonce covers the whole
   * page rather than two of them disagreeing:
   *
   *   markout({ docroot, csp: (req, res) => res.locals.cspNonce })
   *
   * Either way it lands on `res.locals.markoutNonce` for whatever writes the
   * header. It applies to SERVED pages only: `build` has no response to mint
   * one per, and a built page needs its policy written with hashes instead.
   */
  csp?: boolean | ((req: Request, res: Response) => string);
}

/**
 * The two pages a server has to be able to show when there is no page.
 *
 * They are configured separately, and not out of symmetry: one of them is
 * rendered while everything is working and the other exactly when something
 * is not, which is what decides how each may be written.
 */
export interface ErrorPages {
  /**
   * The page for a request that resolved to nothing -- an ordinary markout
   * page, given as a docroot-relative pathname, compiled and rendered like
   * any other. That is what lets a site's 404 look like the site: it gets
   * the same layout, the same kits and the same `:server-` values as
   * everything else, because it IS one of the pages.
   *
   * Defaults to `/404.html` when the docroot has one, which is the name
   * GitHub Pages, Netlify and S3 already look for -- so a docroot that
   * carries a 404 page for its built form serves the same one here, with
   * nothing configured. `false` turns that convention off and restores the
   * bare status line.
   *
   * It applies where markout answers a PAGE request with 404. The refusals
   * in handleNonPageRequests keep their status line: `/npm/...` and dot-paths
   * are namespaces rather than places a visitor navigated to.
   */
  notFound?: string | false;
  /**
   * The page for a docroot that will not compile, as a path to a file of
   * ready-made HTML -- absolute, or relative to the docroot.
   *
   * A file and not a markout page, because of when it is needed: rendering a
   * page in order to report that a page could not be rendered is a loop
   * looking for somewhere to happen, and this one has to work on exactly the
   * occasions the compiler does not. Static HTML is the version with no way
   * to fail.
   *
   * Absent, the visitor gets a bare 500. Either way the errors themselves go
   * to the log, and outside dev mode they go nowhere else.
   */
  error?: string;
}

/**
 * Compiled pages, kept in memory until anything under the docroot changes.
 *
 * Compiling Orbit costs ~120ms against ~40ms to render it, so without this
 * every request pays for reading and compiling the page and every file it
 * imports -- which is most of what a visitor clicking around the demo would
 * be measuring. The COMPILER's output is what is cached, never the HTML:
 * a `:server-` value runs per request by definition, and serving yesterday's
 * answer would make the one feature that distinguishes this framework look
 * like a bug.
 *
 * Invalidation is deliberately blunt. Any change anywhere under the docroot
 * empties the whole cache, rather than working out which pages saw the file
 * that moved -- the preprocessor does record every file it read, so the
 * precise version is available, but a dev server recompiling a handful of
 * pages it did not have to is not worth the chance of missing one it did.
 *
 * If the watcher cannot be established, nothing is cached at all. A stale
 * page is a worse failure than a slow one, and it is the kind someone
 * debugs for an hour before suspecting the server.
 */
function pageCache(
  docroot: string,
  logger: MarkoutLogger,
  compile: (pathname: string) => Promise<Page>,
  /** anything else that goes stale when the docroot changes */
  alsoInvalidate: () => void = () => {}
) {
  // the compile is memoized, not its result: the entry has to exist before
  // the compile is awaited, or every request that arrives while one is in
  // flight finds an empty cache and starts another
  const entries = new Map<string, { page: Promise<Page>; last: Promise<unknown> }>();
  let watcher: TreeWatcher | undefined;
  try {
    // symlinked directories get watchers of their own; a recursive watch
    // does not descend through one, and a kit reached by link is exactly
    // what this docroot is likely to hold. See ./watcher
    watcher = watchTree(docroot, () => {
      entries.clear();
      alsoInvalidate();
    });
    watcher.count > 1 &&
      logger('info', `[markout] watching ${watcher.count} directories (symlinks followed)`);
  } catch (err) {
    logger('info', `[markout] no file watcher (${err}) -- compiling every request`);
  }

  return {
    /**
     * The compiled page, and a turn in the queue for rendering it.
     *
     * Renders are serialized per page because rendering writes into that
     * page's document -- which is the whole reason it can be reused, and
     * also the reason two overlapping requests must not be inside it at
     * once. They would interleave halfway through and each would serve
     * a document holding half of the other's data.
     */
    async use<T>(pathname: string, render: (page: Page) => Promise<T>): Promise<T> {
      if (!watcher) {
        return render(await compile(pathname));
      }
      let entry = entries.get(pathname);
      if (!entry) {
        // recorded before anything is awaited, which is the whole point: the
        // miss and the store used to sit on opposite sides of the compile, so
        // a burst of requests for a cold page each looked, each found nothing,
        // and each compiled a copy nobody but itself would ever render. Ten
        // concurrent requests were ten compiles -- 2ms of waste on an ordinary
        // page and most of a second on one that imports a kit
        entry = { page: compile(pathname), last: Promise.resolve() };
        entries.set(pathname, entry);
        // A FAILED compile is not kept. Caching the rejection would be
        // defensible while the file is broken -- the watcher clears it the
        // moment the author saves -- but not every failure is the page's: a
        // half-written file or an exhausted descriptor limit is a failure to
        // retry, and this cache is emptied only by a change in the docroot,
        // which such a failure need not involve
        entry.page.catch(() => {
          entries.get(pathname) === entry && entries.delete(pathname);
        });
      }
      const page = await entry.page;
      const turn = entry.last.then(() => render(page), () => render(page));
      // the queue must survive a failed render, or one thrown error leaves
      // every later request for that page waiting on a promise nobody settles
      entry.last = turn.catch(() => undefined);
      return turn;
    },
  };
}

export function markout(props: MarkoutProps) {
  const docroot = props.docroot || process.cwd();
  const dev = props.dev ?? false;
  const csp = props.csp;
  const logger = props.logger ?? defaultLogger;
  const globals = props.globals;
  const discovered = props.kits
    ? { kits: props.kits, errors: [] }
    : discoverKits(docroot, [__dirname]);
  // Logged rather than thrown: a refused kit is a pair of things claiming one
  // URL, which leaves every page that did not want that kit perfectly
  // serviceable. Said once, at startup, where somebody is watching.
  discovered.errors.forEach(msg => logger('error', `[markout] ${msg}`));
  discovered.kits.forEach(kit =>
    logger('info', `[markout] kit ${kit.name} at ${kit.root}`)
  );
  const resolver = new Resolver(docroot, discovered.kits);
  const clientCode = loadClientCode();
  const clientSrc = runtimeSrcFor(clientCode);
  const compiler = new Compiler({
    docroot,
    dev,
    kits: discovered.kits,
    generator: props.generator,
    runtimeSrc: clientSrc,
    serverGlobals: globals ? Object.keys(globals) : undefined,
  });
  // Dev only: nothing about this reaches a build, which has no server to
  // stream from. See ./livereload.
  const reloader = dev ? createReloader() : undefined;

  // Which kits the docroot has allowed to contribute pages -- scanned across
  // the whole docroot so the answer does not depend on what has been visited,
  // and memoized because that scan reads every page. Recomputed when the
  // watcher fires, alongside the compiled pages it invalidates.
  let allowed: Promise<Set<string>> | undefined;
  const allowedKits = () => (allowed ??= allowedPageKits(docroot, resolver));
  const errorPages = props.errorPages ?? {};
  // Absolute or docroot-relative, resolved once. `path.resolve` is exactly
  // the rule this wants: an absolute path stays put, anything else lands
  // under the docroot.
  const errorFile = errorPages.error
    ? path.resolve(docroot, errorPages.error)
    : undefined;

  // Which page answers a request for one that is not there. Memoized rather
  // than looked up per request, and forgotten when the watcher fires, so a
  // `404.html` added while the server runs is found without a restart.
  let notFoundPath: string | undefined;
  let notFoundKnown = false;
  function notFoundPage(): string | undefined {
    if (errorPages.notFound === false) {
      return undefined;
    }
    if (errorPages.notFound) {
      return pagePath(errorPages.notFound);
    }
    if (!notFoundKnown) {
      notFoundKnown = true;
      notFoundPath = fs.existsSync(path.join(docroot, DEFAULT_NOT_FOUND))
        ? DEFAULT_NOT_FOUND
        : undefined;
    }
    return notFoundPath;
  }

  const cache = pageCache(
    docroot,
    logger,
    pathname => compiler.compile(pathname),
    () => {
      allowed = undefined;
      notFoundKnown = false;
      // the browser reloads exactly when the server stops believing what it
      // last served, rather than on a second opinion about what changed
      reloader?.notify();
    }
  );

  /**
   * One of the error pages, rendered -- or nothing, which is the caller's
   * cue to fall back to a bare status line.
   *
   * Separate from the main path rather than sharing it, because the two want
   * opposite things from a failure. A page that fails there is news; a page
   * that fails HERE is already the consolation prize, and the one thing it
   * must not do is raise its own error page and arrive back at this function.
   */
  function reportWarnings(page: { errors: PageError[] }, pathname: string): void {
    page.errors.forEach(
      e =>
        e.type === 'warning' &&
        logger('warn', `[markout] ${formatPageError(e, pathname)}`)
    );
  }

  async function renderErrorPage(
    pathname: string,
    req: Request,
    /** where this page's own failures go; see serveNotFound */
    report: (msg: string) => void,
    nonce?: string
  ): Promise<string | undefined> {
    try {
      return await cache.use<string | undefined>(pathname, async page => {
        if (page.hasErrors) {
          page.source.errors.forEach(e => report(formatPageError(e, pathname)));
          return undefined;
        }
        reportWarnings(page, pathname);
        const runtimeErrors = await renderPage(page, {
          origin: originOf(req),
          globals,
          nonce,
        });
        runtimeErrors.forEach(e =>
          logger('error', `[markout] ${pathname} ${formatRuntimeError(e)}`)
        );
        return '<!doctype html>\n' + page.source.doc.toString();
      });
    } catch (err) {
      report(`${pathname} ${err}`);
      return undefined;
    }
  }

  /**
   * Said once, however many requests arrive.
   *
   * A not-found page that cannot be served is one piece of news -- the
   * configuration is wrong -- and it is discovered on the one kind of request
   * anybody can generate without limit. Reported per request, a scanner
   * walking a site for `.env` files would write the whole log, and the
   * compile error behind it repeats identically every time because the
   * failed compile is what the cache is holding.
   */
  let saidNoNotFound = false;

  async function serveNotFound(req: Request, res: Response, nonce?: string) {
    const pathname = notFoundPage();
    const report = (msg: string) => {
      !saidNoNotFound && logger('error', `[markout] ${msg}`);
    };
    const html = pathname
      ? await renderErrorPage(pathname, req, report, nonce)
      : undefined;
    if (html === undefined) {
      if (pathname && !saidNoNotFound) {
        logger('warn', `[markout] not-found page "${pathname}" could not be served`);
        saidNoNotFound = true;
      }
      res.sendStatus(404);
      return;
    }
    res.status(404).header('Content-Type', 'text/html;charset=UTF-8');
    // in dev the 404 page reloads like any other, which is what a mistyped
    // link wants: fixing the page it was pointing at brings it up here
    res.send(reloader ? withReloadScript(html, reloader.script(nonce)) : html);
  }

  // This path is answered here, before the filesystem is consulted, so a real
  // file of the same name is unreachable -- and silently so, which is the
  // whole cost of the runtime no longer being dot-prefixed. Said once at
  // startup rather than per request, and only when there is something to say.
  //
  // Vanishingly unlikely to fire now that the path carries a content hash:
  // nobody writes `markout-runtime.PjLuNGki.js` by hand. Kept because
  // "unreachable, and nothing said" is what it exists to prevent, and the
  // check costs one `existsSync` at startup.
  if (fs.existsSync(path.join(docroot, clientSrc))) {
    logger(
      'warn',
      `[markout] "${clientSrc}" in the docroot is shadowed by the runtime ` +
        `served at that path, and will never be reached`
    );
  }
  if (reloader && fs.existsSync(path.join(docroot, RELOAD_REQ))) {
    logger(
      'warn',
      `[markout] "${RELOAD_REQ}" in the docroot is shadowed by the dev-mode ` +
        `reload stream, and will never be reached`
    );
  }
  reloader && logger('info', '[markout] dev mode: pages reload when the docroot changes');
  const startupNotFound = notFoundPage();
  startupNotFound && logger('info', `[markout] not-found page ${startupNotFound}`);
  errorFile && logger('info', `[markout] error page ${errorFile}`);

  return async function (req: Request, res: Response, next: NextFunction) {
    const i = req.path.lastIndexOf('.');
    const extname = extnameOf(req.path);

    if (reloader?.handle(req, res)) {
      return;
    }

    if (handleNonPageRequests(req, res, i, extname, clientCode, clientSrc, next)) {
      return;
    }

    // Anything that is not a page: served from a kit if one claims it, and
    // otherwise passed on to whatever static layer the application mounted.
    // The kit case has to be answered HERE rather than by an
    // `express.static` per kit, because the middleware owns the mount table
    // and is used on its own as often as through this package's `Server`.
    if (extname !== '.html') {
      return serveKitAsset(req, res, next, resolver);
    }

    // Once this request is known to be for a page, and before anything can
    // answer it: every path from here can end in markup, the not-found and
    // error pages included, and in dev those carry the reload script -- so
    // an error page is the response most likely to be the first one a
    // policy rejects. Not minted for the runtime, a kit asset or the reload
    // stream, none of which is a document and none of which has a script to
    // stamp.
    const nonce = mintNonce(csp, req, res);
    if (nonce !== undefined) {
      res.locals.markoutNonce = nonce;
    }

    if (i < 0 && !req.path.endsWith('/')) {
      // The RESOLVER's pathname, never the request's. `//demos` and `/demos`
      // name the same directory, and echoing the request back into a
      // Location made a protocol-relative url -- a browser reads `//demos/`
      // as `http://demos/` and leaves the site. `/\demos` is the same trick
      // with the separator some browsers accept for `/`.
      //
      // Answering with what the resolver already worked out closes both, and
      // is not a sanitizer bolted onto the request: `Resolution.pathname` is
      // this file's ONE logical identity -- leading slash, forward slashes,
      // no escape, expressed through the root it belongs to -- arrived at by
      // the same normalization that decided which file to stat. There is
      // nothing of the request left in it to be tricked by
      const dir = await directoryPathname(req.path, resolver);
      // Belt and braces, in the shape paths.ts uses for the same reason: a
      // Location this server issues names a path on this ORIGIN, and that is
      // checked here rather than argued for.
      //
      // It cannot fail. `normalizeLogical` builds the pathname by dropping
      // every empty segment and joining what is left under one leading
      // slash, so `//x` and `/\x` are `/x` by the time they get here. But
      // the whole failure being avoided is a Location that looks relative
      // and is not, the guarantee lives in another file, and the cost of the
      // check is a comparison -- so it is made where it is relied on. A
      // pathname that somehow were not local falls through to be resolved
      // and answered like any other request
      if (dir && dir.startsWith('/') && !dir.startsWith('//')) {
        res.redirect(301, `${dir}/`);
        return;
      }
    }

    const pathname = await resolvePath(req, i, resolver, msg =>
      logger('error', `[markout] ${msg}`)
    );
    if (!pathname) {
      return serveNotFound(req, res, nonce);
    }

    // A kit's pages belong to the site only where a page asked for them. The
    // check is here rather than in the resolver because it is about what this
    // SITE publishes, not about where a pathname may land.
    const kit = resolver.rootFor(pathname).kit;
    if (kit && !(await allowedKits()).has(resolver.rootFor(pathname).prefix)) {
      return serveNotFound(req, res, nonce);
    }

    // a union rather than two calls, so that everything touching the
    // page's document happens inside its turn in the queue
    type Served =
      | { errors: PageError[] }
      | { runtimeErrors: RuntimeError[]; html: string };
    const served: Served = await cache.use<Served>(pathname, async page => {
      if (page.hasErrors) {
        return { errors: page.source.errors };
      }
      // said and served: a warning is about a page that compiled, so it goes
      // to whoever can act on it rather than into an error page nobody asked
      // for. Logged on every render, like the runtime errors below -- the
      // cache means that is once per compile, which is when it is news
      reportWarnings(page, pathname);
      const runtimeErrors = await renderPage(page, {
        origin: originOf(req),
        globals,
        nonce,
      });
      // serialized HERE, inside this page's turn rather than after it: the
      // document holds this request's data only until the next render
      // starts writing over it
      return { runtimeErrors, html: page.source.doc.toString() };
    });

    if ('errors' in served) {
      if (
        served.errors.length === 1 &&
        served.errors[0].msg === `File not found "${pathname}"`
      ) {
        return serveNotFound(req, res, nonce);
      }
      // Always, whatever the mode. These say which file will not compile and
      // where -- which is a report for whoever can fix it, and used to be
      // sent to the visitor and to nobody else. Outside dev this log is now
      // the ONLY place it goes, so it cannot be the conditional one.
      served.errors.forEach(e =>
        logger('error', `[markout] ${formatPageError(e, pathname)}`)
      );
      // reloading matters MOST here: an error page is where someone is about
      // to fix the file, and without it that fix leaves the browser showing
      // the error until somebody presses refresh
      return serveErrorPage(served.errors, res, dev, errorFile, reloader, nonce);
    }

    // always logged, whatever the mode
    served.runtimeErrors.forEach(e =>
      logger('error', `[markout] ${pathname} ${formatRuntimeError(e)}`)
    );
    if (dev && served.runtimeErrors.length) {
      return serveRuntimeErrorPage(served.runtimeErrors, res, reloader, nonce);
    }

    res.header('Content-Type', 'text/html;charset=UTF-8');
    const html = '<!doctype html>\n' + served.html;
    res.send(reloader ? withReloadScript(html, reloader.script(nonce)) : html);
  }
}

/**
 * This response's CSP nonce, or nothing when the caller did not ask for one.
 *
 * 16 bytes from `crypto.randomBytes`, which is 128 bits of unpredictability
 * -- the property a nonce needs and the only one it needs. Base64 rather
 * than hex to keep it short, and both are safe in a header and an attribute.
 *
 * A caller-supplied function is trusted with what it returns, including the
 * decision to return nothing: an application whose policy is conditional --
 * a nonce on its own pages and none on a proxied route -- expresses that by
 * returning an empty string, and markout stamps nothing.
 */
function mintNonce(
  csp: MarkoutProps['csp'],
  req: Request,
  res: Response
): string | undefined {
  if (!csp) {
    return undefined;
  }
  if (typeof csp === 'function') {
    return csp(req, res) || undefined;
  }
  // One already there wins. It has to: markout ANSWERS a page request, so
  // nothing mounted after it runs, and a header naming a nonce therefore has
  // to be written before this middleware is reached -- which means the nonce
  // has to exist before it too. `cspNonce()` is that, and minting a second
  // one here would leave the page carrying a token its own policy never
  // heard of.
  const existing = res.locals.markoutNonce;
  if (typeof existing === 'string' && existing) {
    return existing;
  }
  return randomBytes(16).toString('base64');
}

/**
 * Mints this response's nonce early, for an application that writes its own
 * Content-Security-Policy header.
 *
 * Mounted BEFORE `markout()`, which is the only order that can work: a page
 * request ends at markout, so a header has to be set on the way in, and a
 * header naming a nonce needs the nonce to exist by then. This puts it on
 * `res.locals.markoutNonce`; `markout({ csp: true })` finds it there and
 * stamps the same value on the scripts it injects.
 *
 *   app.use(cspNonce());
 *   app.use((req, res, next) => {
 *     res.setHeader('Content-Security-Policy',
 *       `script-src 'nonce-${res.locals.markoutNonce}'`);
 *     next();
 *   });
 *   app.use(markout({ docroot, csp: true }));
 *
 * An application already minting one -- helmet's `res.locals.cspNonce` --
 * does not need this and should point `csp` at what it has instead.
 */
export function cspNonce(): RequestHandler {
  return function (_req: Request, res: Response, next: NextFunction) {
    res.locals.markoutNonce ??= randomBytes(16).toString('base64');
    next();
  };
}

/**
 * The page's own origin, as `$origin` -- what a browser would call
 * `location.origin` for the same page.
 *
 * `req.protocol` and `req.host` already honour `X-Forwarded-*` when Express
 * is configured to trust its proxy, which is where a deployment behind one
 * has to say so; getting it wrong here would show up as a `:server-` fetch
 * addressed to the wrong host rather than as a subtle mismatch.
 */
function originOf(req: Request): string | undefined {
  const host = req.get('host');
  return host ? `${req.protocol}://${host}` : undefined;
}

/**
 * The extension a request is answered by: its own, or `.html` when it has
 * none, since an extensionless path is a page request.
 *
 * One definition, because this rule decides two things that must not
 * disagree -- what the middleware renders, and what a rate limiter counts.
 * A limiter spelling it differently means either a request that costs a
 * render and is not counted, or an image that is.
 */
function extnameOf(pathname: string): string {
  const i = pathname.lastIndexOf('.');
  return i < 0 ? '.html' : pathname.substring(i).toLowerCase();
}

/**
 * Whether a path is one the pages answer -- an extensionless path, or a
 * `.html` one.
 *
 * Exported for whoever is deciding what a page request COSTS: a rate limiter
 * in front of these pages wants to count renders and not assets, and the
 * only way for it to agree with the middleware is to ask the middleware.
 */
export function isPageRequest(pathname: string): boolean {
  return extnameOf(pathname) === '.html';
}

async function directoryPathname(
  requestPath: string,
  resolver: Resolver
): Promise<string | undefined> {
  // through the resolver like every other path question, so that this one
  // does not become the place where containment was forgotten -- it used to
  // resolve against the docroot without checking, and only Express having
  // already normalized `..` out of `req.path` kept that from mattering
  const resolved = resolver.resolve(requestPath);
  if (!resolved.ok) {
    return undefined;
  }
  try {
    // the resolver's own pathname rather than the caller's, which is what
    // makes it safe to put in a Location: see the redirect above
    return (await fs.promises.stat(resolved.filePath)).isDirectory()
      ? resolved.pathname
      : undefined;
  } catch {
    return undefined;
  }
}

function handleNonPageRequests(
  req: Request,
  res: Response,
  _i: number,
  extname: string,
  clientCode: string,
  clientSrc: string,
  next: NextFunction
) {
  if (req.path === clientSrc) {
    res.header('Content-Type', 'text/javascript;charset=UTF-8');
    // the URL names the bytes, so it can never come to mean different ones
    // and a browser never has to ask again. It used to carry no
    // `Cache-Control` at all, which spent a conditional request per visit
    // to be told the bundle had not changed
    res.header('Cache-Control', RUNTIME_CACHE_CONTROL);
    res.send(clientCode);
    return true;
  }
  // The one dot-path that exists in order to be public (RFC 8615), so it is
  // handed to the static layer instead of refused. Passed on HERE rather than
  // by loosening the check below it: an ACME challenge token has no extension,
  // so a request that merely got past the refusal would be resolved as a PAGE
  // and 404 all the same.
  //
  // What this buys, beyond agreeing with what `build` copies: a certificate can
  // be issued for a docroot served by markout directly, which the blanket
  // refusal made impossible -- the 404 happened before `express.static` ever
  // saw the request.
  if (req.path.startsWith(WELL_KNOWN_PREFIX)) {
    next();
    return true;
  }
  // `/npm/...` is how a kit's files are addressed at COMPILE time and
  // nowhere else. Serving it would give the same bytes a second URL with
  // nothing to choose between them, and one that none of the publishing
  // rules governs -- so it is refused rather than merely unused.
  if (req.path === NPM_PREFIX.slice(0, -1) || req.path.startsWith(NPM_PREFIX)) {
    res.sendStatus(404);
    return true;
  }
  if (req.path.startsWith('/.') || extname === '.htm') {
    res.sendStatus(404);
    return true;
  }
  return false;
}

/**
 * A file from a mounted kit, or nothing at all.
 *
 * `next()` rather than a 404 when no kit claims the path, so the application's
 * own static layer -- `express.static(docroot)`, usually mounted right after
 * this -- still gets its turn, exactly as it did before kits existed.
 */
async function serveKitAsset(
  req: Request,
  res: Response,
  next: NextFunction,
  resolver: Resolver
) {
  const at = resolver.resolve(req.path);
  if (!at.ok || !at.root.kit || !publishablePath(at.pathname)) {
    return next();
  }
  res.sendFile(at.filePath, { dotfiles: 'ignore' }, err => err && next());
}

/**
 * Errors that mean "there is no such file", as against "I could not find
 * out whether there is".
 *
 * A name too long, or one holding a NUL byte, is a name nothing can be
 * called: the file is not there in the only sense a visitor cares about.
 * `EACCES` is deliberately not among them -- that one says the file is
 * there and the server cannot look at it, which is a fact about the
 * deployment and not about the URL.
 */
const ABSENT_ERRNOS = new Set(['ENOENT', 'ENOTDIR', 'ENAMETOOLONG', 'EINVAL', 'EILSEQ']);

// exported for direct unit testing: Express normalizes `..` out of req.path
// before any middleware sees it, so a real HTTP request can't exercise the
// bypass this guards against
export async function resolvePath(
  req: Request,
  i: number,
  resolver: Resolver,
  /** told when a page could not be looked up, as against not being there */
  report: (msg: string) => void = () => {}
) {
  let pathname = i < 0 ? req.path : req.path.substring(0, i).toLowerCase();
  // containment lives in the resolver, which is also what knows about roots
  // other than the docroot -- see ../paths
  const resolved = resolver.resolve(pathname);
  if (!resolved.ok) {
    return;
  }
  const fullPath = resolved.filePath;
  if (i < 0) {
    try {
      let stat = null;
      try {
        stat = await fs.promises.stat(fullPath);
      } catch {
        // try adding .html extension if no extension was provided
        stat = await fs.promises.stat(fullPath + '.html');
      }
      if (stat.isDirectory()) {
        // if path is a dir, access <dir>/index.html
        pathname = path.join(pathname, 'index');
      }
    } catch (err) {
      // "not there" is the ordinary answer and says nothing; anything else
      // is the server failing to look, and used to arrive as the same 404.
      // A permission error on a docroot, an EMFILE under load, a disk that
      // has gone away -- every one of them reported the page missing, in an
      // access log full of 404s, with the file sitting right there. The
      // status is unchanged, because a visitor has no better answer to be
      // given; what changes is that somebody is told
      const code = (err as NodeJS.ErrnoException)?.code;
      code &&
        !ABSENT_ERRNOS.has(code) &&
        report(
          `${pathname}: cannot tell whether this page exists (${code}) -- ` +
            `serving it as not found`
        );
      return;
    }
  }
  return pathname + '.html';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A configured page pathname in the shape the compiler takes: docroot
 * relative, leading slash, `.html` when no extension was given. `404`,
 * `/404` and `/404.html` are the same page, because all three are what
 * somebody will write.
 */
function pagePath(pathname: string): string {
  const s = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return path.extname(s) ? s : `${s}.html`;
}

/**
 * One compile error, for the log, in the shape `build` already prints and
 * editors and log scrapers already parse: `file:line:col: message`.
 *
 * The file is the error's OWN source rather than the page that was asked
 * for. Usually they are the same; when they are not, the page was fine and
 * something it imported was not, and the imported file is the one somebody
 * has to open.
 */
function formatPageError(e: PageError, pathname: string): string {
  const l = e.loc;
  const where = l
    ? `${l.source ?? pathname}:${l.start.line}:${l.start.column + 1}`
    : pathname;
  return `${where}: ${e.msg}`;
}

/**
 * A docroot that will not compile, reported to whoever asked for the page.
 *
 * What is IN that report depends on the mode, and it did not use to. The
 * detailed listing below names the source file and the line, which is the
 * right answer for the person holding the editor and an odd thing to hand a
 * stranger: outside dev mode a broken deployment was describing its own
 * sources to anyone who asked, while the log -- the one place the operator
 * would look -- said nothing at all. Both halves of that are fixed here and
 * at the call site: the detail is dev's, the log is unconditional, and
 * production gets the configured page or a bare status.
 */
function serveErrorPage(
  errors: PageError[],
  res: Response,
  dev: boolean,
  errorFile?: string,
  reloader?: Reloader,
  nonce?: string
) {
  if (!dev) {
    if (errorFile) {
      try {
        // read before anything is written to the response, so that a file
        // that has gone missing falls back cleanly instead of arriving as a
        // 500 with an HTML content type and no HTML in it
        const html = fs.readFileSync(errorFile, 'utf8');
        res.status(500).header('Content-Type', 'text/html;charset=UTF-8').send(html);
        return;
      } catch {
        // an unreadable error page is not a reason to fail differently
      }
    }
    res.sendStatus(500);
    return;
  }
  const p = new Array<string>();
  p.push(`<!doctype html><html><head>
    <title>Page Error</title>
    <meta name="color-scheme" content="light dark"/>
    </head><body><ul>`);
  errors.forEach(err => {
    const l = err.loc;
    p.push(`<li>${escapeHtml(err.msg)}`);
    l && p.push(` - ${escapeHtml(l.source ?? '')} `);
    l && p.push(`[${l.start.line}, ${l.start.column + 1}]`);
    p.push('</li>');
  });
  p.push('</ul></body></html>');
  res.header('Content-Type', 'text/html;charset=UTF-8');
  const html = p.join('');
  res.status(500).send(reloader ? withReloadScript(html, reloader.script(nonce)) : html);
}

/**
 * Dev mode only. Server rendering hit these errors, so the page it produced
 * is already wrong -- and shipping it would send the browser off to run the
 * very same expressions against the very same initial values, fail
 * identically, and paint its own report over a page that was never going to
 * work. A page built solely from the errors says the one useful thing, and
 * carries no runtime to muddy it.
 */
function serveRuntimeErrorPage(
  errors: RuntimeError[],
  res: Response,
  reloader?: Reloader,
  nonce?: string
) {
  const p = new Array<string>();
  p.push(`<!doctype html><html><head>
    <title>Page Error</title>
    <meta name="color-scheme" content="light dark"/>
    </head><body><ul>`);
  errors.forEach(e => p.push(`<li>${escapeHtml(formatRuntimeError(e))}</li>`));
  p.push('</ul></body></html>');
  res.header('Content-Type', 'text/html;charset=UTF-8');
  const html = p.join('');
  res.status(500).send(reloader ? withReloadScript(html, reloader.script(nonce)) : html);
}
