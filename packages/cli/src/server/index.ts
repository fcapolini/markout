import compression from "compression";
import express, { Application, RequestHandler } from "express";
import path from "path";
import fs from "fs";
import http from "http";
import https from "https";
import exitHook from './exit-hook';
import {
  defaultLogger,
  markout,
  type ErrorPages,
  type MarkoutLogger,
} from "@markout-dev/express";
import process from "process";
import { AddressInfo } from "net";

/**
 * A server for a docroot, and -- as far as it can be -- for the application
 * around it.
 *
 * The alternative to this class is `@markout-dev/express`: an application
 * builds its own Express app, mounts `markout()` in it and listens itself.
 * That arrangement is always available and nothing here replaces it, but it
 * used to be the answer to questions as small as "how do I bind to
 * 127.0.0.1" -- and once a project has hand-rolled the app in order to get
 * one prop, it has also taken ownership of the mount ORDER, which is the
 * part that is easy to get subtly wrong. Pages are extensionless paths, so
 * markout has to be asked after the application's own routes and before the
 * static layer; a project that only wanted a bind address now maintains that
 * invariant forever.
 *
 * So the props below are meant to cover the ordinary reasons somebody left.
 * `routes` and `init` are the two that matter most: they are the application's
 * own handlers, mounted where they belong, with markout still assembled by
 * the code that knows the order.
 */
export interface ServerProps {
  docroot: string;
  port?: number;
  /**
   * The address to bind, e.g. `'127.0.0.1'`. Absent binds every interface,
   * which is what a container wants and what a laptop on a shared network
   * generally does not.
   */
  hostname?: string;
  /**
   * Serve HTTPS directly, from a key and certificate given as FILE PATHS.
   *
   * Usually the wrong layer -- a deployment behind a proxy terminates TLS
   * there and sets `trustProxy` here instead. It exists for the cases with no
   * proxy to put it in: a LAN device, and local development of anything
   * gated behind a secure context (service workers, `crypto.subtle`,
   * geolocation), where a self-signed pair is the whole setup.
   */
  ssl?: { key: string; cert: string; ca?: string };
  /**
   * What Express should believe about `X-Forwarded-*`; see
   * https://expressjs.com/en/guide/behind-proxies.html
   *
   * `true` is the historical spelling here and still means one proxy. A
   * number is how many hops to trust, a string is an address or subnet.
   * Worth getting right rather than leaving off: a page's `$origin` is
   * derived from the request's protocol and host, so behind an unacknowledged
   * proxy every `:server-` fetch of a relative URL is addressed to `http://`
   * and the internal port.
   */
  trustProxy?: boolean | number | string;
  logger?: MarkoutLogger;
  /**
   * Say nothing at all. Overrides `logger`, and exists because passing
   * `() => {}` as a logger is the one thing every embedding test did.
   */
  mute?: boolean;
  /** surface runtime expression errors in the page; see MarkoutProps */
  dev?: boolean;
  /** gzip/deflate responses for clients that accept them */
  compress?: boolean;
  /** objects pages may reach from a `:server-` value; see MarkoutProps */
  globals?: { [name: string]: unknown };
  /**
   * What a visitor gets instead of a bare status line: a not-found page of
   * the site's own, and a page for a docroot that will not compile. See
   * ErrorPages -- a docroot holding a `404.html` needs neither set.
   */
  errorPages?: ErrorPages;
  /**
   * The body size `express.json()` and `express.urlencoded()` will accept.
   * Express defaults to `'100kb'`, which is generous for a form and small
   * for an upload; either way the failure is a 413 from a parser the
   * application never mounted, so the knob is here.
   */
  bodyLimit?: string | number;
  /**
   * The application's own handlers, as `mount path -> handler`, mounted
   * BEFORE markout answers anything.
   *
   *     routes: {
   *       '/api': myApiRouter,
   *       '/assets': express.static('/var/lib/assets'),
   *     }
   *
   * Before, because whoever answers first wins and these paths are the
   * application's. An Express `Router` is a handler like any other, so this
   * is the whole of what a hand-rolled app was usually for -- including
   * mounting middleware that has to see every request, at `'/'`, which is
   * where a rate limiter or a session store goes.
   */
  routes?: { [mountPath: string]: RequestHandler | RequestHandler[] };
  /**
   * The same position as `routes`, with the app itself instead of a table:
   * for anything that is not a mount -- `app.set('view engine', ...)`,
   * `app.get()` with a method and a pattern, a handler that needs to close
   * over the app.
   *
   * Runs after `routes` when both are given, and may be async so that a
   * database can be opened before the first request is answered.
   */
  init?: (app: Application, props: ServerProps) => void | Promise<void>;
  /**
   * The last word: mounted after markout AND after the static layer, so it
   * sees only what nothing else claimed.
   *
   * This is where an error handler goes -- Express recognizes those by their
   * four arguments, and mounted here one catches whatever `routes`, `init`
   * and markout itself threw.
   *
   * What it does NOT see is a request for a page that does not exist.
   * Markout answers that one with a 404 of its own rather than passing it
   * on, which is what makes an extensionless path a page request at all: if
   * a missing page fell through to here, so would every path a single-page
   * app might have wanted, and the two are indistinguishable from the
   * outside. So this runs for the leftovers of everything else -- a missing
   * asset, a method nothing handled -- and a custom page-not-found page
   * remains a reason to mount `markout()` yourself.
   */
  fallback?: (app: Application, props: ServerProps) => void | Promise<void>;
}

export class Server {
  private props: ServerProps;
  private logger: MarkoutLogger;
  server?: http.Server;
  port?: number;
  app?: Application;

  constructor(props: ServerProps) {
    this.props = props;
    this.logger = props.mute ? () => {} : props.logger || defaultLogger;
  }

  /**
   * The configured Express app, with nothing listening on it.
   *
   * Separate from `start()` because a test wants the app and not a port --
   * supertest binds its own ephemeral one per request -- and because that
   * want was, on its own, a reason to hand-roll the app and inherit the
   * mount order along with it.
   *
   * Idempotent: the app is built once and returned thereafter, so `start()`
   * after `create()` listens on the app that was already configured.
   */
  async create(): Promise<Application> {
    if (this.app) {
      return this.app;
    }
    const config = this.props;
    const app = (this.app = express());
    config.docroot ||= process.cwd();

    // before any middleware that can write a body, so it wraps them all
    config.compress && app.use(compression());
    const bodyOpts = config.bodyLimit ? { limit: config.bodyLimit } : {};
    app.use(express.json(bodyOpts));
    app.use(express.urlencoded({ extended: true, ...bodyOpts }));
    // see https://expressjs.com/en/guide/behind-proxies.html -- `true` kept
    // meaning one hop, which is what it meant when it was the only option
    if (config.trustProxy != null && config.trustProxy !== false) {
      app.set('trust proxy', config.trustProxy === true ? 1 : config.trustProxy);
    }

    // ------------------------------------------------- the application's own
    //
    // First, because whoever answers first wins. A page is an extensionless
    // path and so is most of an API, and the one that belongs to the
    // application is the one it declared here.
    for (const [mountPath, handler] of Object.entries(config.routes ?? {})) {
      app.use(mountPath, ...(Array.isArray(handler) ? handler : [handler]));
    }
    await config.init?.(app, config);

    // ------------------------------------------------------------- the pages
    app.use(markout({ ...config, logger: this.logger }));

    // `/.well-known/` needs a mount of its own: the middleware declines that
    // path rather than refusing it (RFC 8615 -- it exists in order to be
    // public), but `express.static` will not serve a dot-prefixed path on its
    // own, so declining it would still have ended in a 404.
    //
    // Mounted narrowly rather than by allowing dotfiles on the docroot at
    // large. The middleware refuses every OTHER `/.` path, so the two together
    // are already safe -- but "safe because of what runs before it" is a
    // property nobody can see at the line that would publish `.env`.
    app.use(
      '/.well-known',
      express.static(path.join(config.docroot, '.well-known'), { dotfiles: 'allow' })
    );

    app.use(express.static(config.docroot));

    // ------------------------------------------------------ nothing wanted it
    await config.fallback?.(app, config);
    return app;
  }

  async start(): Promise<this> {
    if (this.server) {
      return this;
    }
    const config = this.props;
    const app = await this.create();

    this.server = config.ssl
      ? https.createServer(
          {
            key: fs.readFileSync(config.ssl.key),
            cert: fs.readFileSync(config.ssl.cert),
            ...(config.ssl.ca ? { ca: fs.readFileSync(config.ssl.ca) } : {}),
          },
          app
        )
      : http.createServer(app);

    // awaited rather than assumed. Binding a TCP port happens to complete
    // before `listen()` returns, so reading the address straight after it
    // worked -- but that is true of TCP and not of the call, and everything
    // logged below claims the server is up
    const server = this.server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      config.hostname
        ? server.listen(config.port, config.hostname, resolve)
        : server.listen(config.port, resolve);
    });
    this.port = (server.address() as AddressInfo).port;

    // what it is, then that it is up -- the address goes LAST so that a
    // reader who has seen it has seen the whole configuration. Anything
    // watching the console for readiness keys off that line, and with it
    // logged first the lines after it were a race: the CLI test caught the
    // output at the address and asserted on a `compression enabled` that had
    // not been written yet, roughly one run in five
    this.logger('info', `[server] docroot ${config.docroot}`);
    config.dev && this.logger('info', '[server] dev mode: runtime errors will be shown in the page');
    config.compress && this.logger('info', '[server] compression enabled');
    const mounts = Object.keys(config.routes ?? {});
    mounts.length && this.logger('info', `[server] application routes at ${mounts.join(', ')}`);
    const scheme = config.ssl ? 'https' : 'http';
    this.logger('info', `[server] address ${scheme}://${config.hostname ?? '127.0.0.1'}:${this.port}/`);
    exitHook(() => this.logger('info', '[server] will exit'));
    process.on('uncaughtException', err => {
      this.logger('error', err.stack ? err.stack : `${err}`);
    });
    return this;
  }

  /**
   * Stop listening, and wait until it has.
   *
   * Awaited because it is used between tests: `close()` returning is only
   * the promise to stop accepting connections, and a suite that starts the
   * next server on the same port before this one has let go gets an
   * `EADDRINUSE` in whichever test happened to be next.
   */
  async stop(): Promise<this> {
    const server = this.server;
    if (server) {
      this.server = undefined;
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    return this;
  }
}
