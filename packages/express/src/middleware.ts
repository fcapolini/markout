import { NextFunction, Request, Response } from "express";
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
  PageError,
  publishablePath,
  renderPage,
  Resolver,
  RuntimeError,
  type Kit,
  type Page,
} from "@markout-dev/core";
import { defaultLogger, MarkoutLogger } from "./logger";
import { createReloader, RELOAD_REQ, Reloader, withReloadScript } from "./livereload";
import { TreeWatcher, watchTree } from "./watcher";

export const CLIENT_CODE_REQ = DEFAULT_RUNTIME_SRC;

/** see handleNonPageRequests, and build.ts's SERVABLE_DOTFILES */
const WELL_KNOWN_PREFIX = '/.well-known/';

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
  const entries = new Map<string, { page: Page; last: Promise<unknown> }>();
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
      const hit = watcher && entries.get(pathname);
      const page = hit ? hit.page : await compile(pathname);
      if (!watcher) {
        return render(page);
      }
      const entry = entries.get(pathname) ?? { page, last: Promise.resolve() };
      entries.set(pathname, entry);
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
  const logger = props.logger ?? defaultLogger;
  const globals = props.globals;
  const discovered = props.kits ? { kits: props.kits, errors: [] } : discoverKits(docroot);
  // Logged rather than thrown: a refused kit is a pair of things claiming one
  // URL, which leaves every page that did not want that kit perfectly
  // serviceable. Said once, at startup, where somebody is watching.
  discovered.errors.forEach(msg => logger('error', `[markout] ${msg}`));
  discovered.kits.forEach(kit =>
    logger('info', `[markout] kit ${kit.name} at ${kit.root}`)
  );
  const resolver = new Resolver(docroot, discovered.kits);
  const compiler = new Compiler({
    docroot,
    dev,
    kits: discovered.kits,
    serverGlobals: globals ? Object.keys(globals) : undefined,
  });
  const clientCode = loadClientCode();
  // Dev only: nothing about this reaches a build, which has no server to
  // stream from. See ./livereload.
  const reloader = dev ? createReloader() : undefined;

  // Which kits the docroot has allowed to contribute pages -- scanned across
  // the whole docroot so the answer does not depend on what has been visited,
  // and memoized because that scan reads every page. Recomputed when the
  // watcher fires, alongside the compiled pages it invalidates.
  let allowed: Promise<Set<string>> | undefined;
  const allowedKits = () => (allowed ??= allowedPageKits(docroot, resolver));
  const cache = pageCache(
    docroot,
    logger,
    pathname => compiler.compile(pathname),
    () => {
      allowed = undefined;
      // the browser reloads exactly when the server stops believing what it
      // last served, rather than on a second opinion about what changed
      reloader?.notify();
    }
  );

  // This path is answered here, before the filesystem is consulted, so a real
  // file of the same name is unreachable -- and silently so, which is the
  // whole cost of the runtime no longer being dot-prefixed. Said once at
  // startup rather than per request, and only when there is something to say.
  if (fs.existsSync(path.join(docroot, CLIENT_CODE_REQ))) {
    logger(
      'warn',
      `[markout] "${CLIENT_CODE_REQ}" in the docroot is shadowed by the runtime ` +
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

  return async function (req: Request, res: Response, next: NextFunction) {
    const i = req.path.lastIndexOf('.');
    const extname = i < 0 ? '.html' : req.path.substring(i).toLowerCase();

    if (reloader?.handle(req, res)) {
      return;
    }

    if (handleNonPageRequests(req, res, i, extname, clientCode, next)) {
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

    if (i < 0 && !req.path.endsWith('/') && (await isDirectory(req.path, resolver))) {
      res.redirect(301, `${req.path}/`);
      return;
    }

    const pathname = await resolvePath(req, i, resolver);
    if (!pathname) {
      res.sendStatus(404);
      return;
    }

    // A kit's pages belong to the site only where a page asked for them. The
    // check is here rather than in the resolver because it is about what this
    // SITE publishes, not about where a pathname may land.
    const kit = resolver.rootFor(pathname).kit;
    if (kit && !(await allowedKits()).has(resolver.rootFor(pathname).prefix)) {
      res.sendStatus(404);
      return;
    }

    // a union rather than two calls, so that everything touching the
    // page's document happens inside its turn in the queue
    type Served =
      | { errors: PageError[] }
      | { runtimeErrors: RuntimeError[]; html: string };
    const served: Served = await cache.use<Served>(pathname, async page => {
      if (page.source.errors.length) {
        return { errors: page.source.errors };
      }
      const runtimeErrors = await renderPage(page, { origin: originOf(req), globals });
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
        res.sendStatus(404);
        return;
      }
      // reloading matters MOST here: an error page is where someone is about
      // to fix the file, and without it that fix leaves the browser showing
      // the error until somebody presses refresh
      return serveErrorPage(served.errors, res, reloader);
    }

    // always logged, whatever the mode
    served.runtimeErrors.forEach(e =>
      logger('error', `[markout] ${pathname} ${formatRuntimeError(e)}`)
    );
    if (dev && served.runtimeErrors.length) {
      return serveRuntimeErrorPage(served.runtimeErrors, res, reloader);
    }

    res.header('Content-Type', 'text/html;charset=UTF-8');
    const html = '<!doctype html>\n' + served.html;
    res.send(reloader ? withReloadScript(html, reloader.script()) : html);
  }
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

async function isDirectory(requestPath: string, resolver: Resolver): Promise<boolean> {
  // through the resolver like every other path question, so that this one
  // does not become the place where containment was forgotten -- it used to
  // resolve against the docroot without checking, and only Express having
  // already normalized `..` out of `req.path` kept that from mattering
  const resolved = resolver.resolve(requestPath);
  if (!resolved.ok) {
    return false;
  }
  try {
    return (await fs.promises.stat(resolved.filePath)).isDirectory();
  } catch {
    return false;
  }
}

function handleNonPageRequests(
  req: Request,
  res: Response,
  _i: number,
  extname: string,
  clientCode: string,
  next: NextFunction
) {
  if (req.path === CLIENT_CODE_REQ) {
    res.header('Content-Type', 'text/javascript;charset=UTF-8');
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

// exported for direct unit testing: Express normalizes `..` out of req.path
// before any middleware sees it, so a real HTTP request can't exercise the
// bypass this guards against
export async function resolvePath(
  req: Request,
  i: number,
  resolver: Resolver
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
    } catch (ignored) {
      // Intentionally ignore file system errors (file not found, permission denied, etc.)
      // Return undefined to let caller handle with 404 response
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

function serveErrorPage(errors: PageError[], res: Response, reloader?: Reloader) {
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
  res.status(500).send(reloader ? withReloadScript(html, reloader.script()) : html);
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
  reloader?: Reloader
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
  res.status(500).send(reloader ? withReloadScript(html, reloader.script()) : html);
}
