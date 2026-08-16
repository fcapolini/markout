import { PageError } from "../html/parser";
import { NextFunction, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { Compiler } from "../compiler";
import { DEFAULT_RUNTIME_SRC } from "../compiler/stages/stage7-generate";
import { formatRuntimeError, RuntimeError } from "../runtime/core/core-context";
import { defaultLogger, MarkoutLogger } from "./logger";
import { renderPage } from "./render";

export const CLIENT_CODE_REQ = DEFAULT_RUNTIME_SRC;

// __dirname is src/server (dev, via tsx) or dist/server (built); either way
// this is exactly two levels below the project root, where esbuild puts the
// bundle (see scripts/build-runtime.mjs)
const RUNTIME_BUNDLE_PATH = path.join(__dirname, '../../dist/markout-runtime.js');

function loadClientCode(): string {
  try {
    return fs.readFileSync(RUNTIME_BUNDLE_PATH, 'utf8');
  } catch {
    console.warn(`[markout] runtime bundle not found at "${RUNTIME_BUNDLE_PATH}" -- run "npm run build:runtime"`);
    return '';
  }
}

export interface MarkoutProps {
  docroot: string;
  /**
   * Surface runtime expression errors in the served page (and tell the
   * browser runtime to do the same after hydration). Off by default: outside
   * dev mode these are logged server-side and never reach the markup.
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
}

export function markout(props: MarkoutProps) {
  const docroot = props.docroot || process.cwd();
  const dev = props.dev ?? false;
  const logger = props.logger ?? defaultLogger;
  const globals = props.globals;
  const compiler = new Compiler({
    docroot,
    dev,
    serverGlobals: globals ? Object.keys(globals) : undefined,
  });
  const clientCode = loadClientCode();

  return async function (req: Request, res: Response, next: NextFunction) {
    const i = req.path.lastIndexOf('.');
    const extname = i < 0 ? '.html' : req.path.substring(i).toLowerCase();

    if (handleNonPageRequests(req, res, i, extname, clientCode, next)) {
      return;
    }

    if (i < 0 && !req.path.endsWith('/') && (await isDirectory(req.path, docroot))) {
      res.redirect(301, `${req.path}/`);
      return;
    }

    const pathname = await resolvePath(req, i, docroot);
    if (!pathname) {
      res.sendStatus(404);
      return;
    }

    const page = await compiler.compile(pathname);
    if (page.source.errors.length) {
      if (
        page.source.errors.length === 1 &&
        page.source.errors[0].msg === `File not found "${pathname}"`
      ) {
        res.sendStatus(404);
        return;
      }
      return serveErrorPage(page.source.errors, res);
    }

    const runtimeErrors = await renderPage(page, { origin: originOf(req), globals });
    // always logged, whatever the mode
    runtimeErrors.forEach(e =>
      logger('error', `[markout] ${pathname} ${formatRuntimeError(e)}`)
    );
    if (dev && runtimeErrors.length) {
      return serveRuntimeErrorPage(runtimeErrors, res);
    }

    let doc = page.source.doc;
    const html = doc.toString();
    res.header('Content-Type', 'text/html;charset=UTF-8');
    res.send('<!doctype html>\n' + html);
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

async function isDirectory(requestPath: string, docroot: string): Promise<boolean> {
  const relativePath = requestPath.startsWith('/')
    ? requestPath.slice(1)
    : requestPath;
  try {
    return (await fs.promises.stat(path.resolve(docroot, relativePath))).isDirectory();
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
  if (req.path.startsWith('/.') || extname === '.htm') {
    res.sendStatus(404);
    return true;
  }
  if (extname !== '.html') {
    next();
    return true;
  }
  return false;
}

// exported for direct unit testing: Express normalizes `..` out of req.path
// before any middleware sees it, so a real HTTP request can't exercise the
// bypass this guards against
export async function resolvePath(
  req: Request,
  i: number,
  docroot: string
) {
  let pathname = i < 0 ? req.path : req.path.substring(0, i).toLowerCase();
  const root = path.resolve(docroot);
  // Remove leading slash to ensure relative path resolution
  const relativePath = pathname.startsWith('/')
    ? pathname.slice(1)
    : pathname;
  const fullPath = path.resolve(root, relativePath);
  // Ensure the resolved path is contained in docroot: a plain startsWith(root)
  // would also match a sibling directory sharing the same prefix, e.g. `root`
  // = "/a/site" and a candidate of "/a/site-other/secret"
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
    return;
  }
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

function serveErrorPage(errors: PageError[], res: Response) {
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
  // res.sendStatus(500);
  res.status(500).send(p.join(''));
}

/**
 * Dev mode only. Server rendering hit these errors, so the page it produced
 * is already wrong -- and shipping it would send the browser off to run the
 * very same expressions against the very same initial values, fail
 * identically, and paint its own report over a page that was never going to
 * work. A page built solely from the errors says the one useful thing, and
 * carries no runtime to muddy it.
 */
function serveRuntimeErrorPage(errors: RuntimeError[], res: Response) {
  const p = new Array<string>();
  p.push(`<!doctype html><html><head>
    <title>Page Error</title>
    <meta name="color-scheme" content="light dark"/>
    </head><body><ul>`);
  errors.forEach(e => p.push(`<li>${escapeHtml(formatRuntimeError(e))}</li>`));
  p.push('</ul></body></html>');
  res.header('Content-Type', 'text/html;charset=UTF-8');
  res.status(500).send(p.join(''));
}
