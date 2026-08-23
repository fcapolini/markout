/**
 * The site: the homepage, the demos, and the one service among them.
 *
 * Not markout's own `Server` class but a plain Express app, because this is
 * the worked example of the arrangement `@markout-lang/express` is for: the
 * application's own routes FIRST, then markout, then static files. That
 * order is a requirement rather than a preference; a path with no extension
 * is a page request, and markout answers it.
 *
 *     npm run dev
 *
 * Exactly one demo needs a route of its own -- the desk, whose whole subject
 * is this arrangement. Orbit, much the larger of the two, needs none: its
 * data is a directory of JSON files any static host would serve. Between
 * them they are the two answers to "where does a page's data come from",
 * and markout is the same in both.
 *
 * Exported as a factory as well as run directly, so the tests drive the same
 * routes a browser gets rather than a second copy of them.
 *
 * What runs at markout.dev is this file compiled to JavaScript, in the image
 * `Dockerfile` builds. See DEPLOY.md.
 */
import compression from "compression";
import express, { type Express } from 'express';
import { markout } from '@markout-lang/express';
import { deskApi } from './demos/desk/api';

export interface SiteProps {
  docroot: string;
  /** surface runtime expression errors in the page */
  dev?: boolean;
  /**
   * How many proxies stand between this app and the visitor, or `false` for
   * none, which is the default and what a test or a dev server wants.
   *
   * Deployed, there is exactly one: CapRover's nginx terminates TLS and
   * forwards. Until Express is told so, `req.protocol` is the http of that
   * last hop and `req.ip` is the proxy's -- so a page asking what its own
   * URL is gets `http://` for a site that is only reachable over https.
   * See https://expressjs.com/en/guide/behind-proxies.html.
   */
  trustProxy?: number | boolean;
}

export function createSite(props: SiteProps): Express {
  const app = express();
  if (props.trustProxy) {
    // `true` kept meaning one hop, which is what it means here
    app.set('trust proxy', props.trustProxy === true ? 1 : props.trustProxy);
  }
  app.use(compression());

  // ------------------------------------------------------- the health check
  //
  // The one route here that is not part of the site, and it is a route rather
  // than a page for the reason everything else on this list is mounted in the
  // order it is: `/healthz` has no extension, so left to itself it would be a
  // page request, and a container asking every few seconds whether the
  // process is alive would be answered by compiling the homepage.
  app.get('/healthz', (_req, res) => {
    res.type('text/plain').send('ok');
  });

  // -------------------------------------------------------- the service
  //
  // One demo's own back end, mounted under the pages that read it. Markout
  // knows nothing about it; it is here first because whoever answers first
  // wins, and these paths are the application's.
  app.use('/demos/desk/api', deskApi());

  // ------------------------------------------------------------ the pages
  app.use(markout({ docroot: props.docroot, dev: props.dev }));

  // ----------------------------------------------------------- the assets
  //
  // Everything markout declined: the favicons, the social card, the demos'
  // stylesheets and the JSON files Orbit reads. `express.static` says
  // `max-age=0` unless told otherwise, so each of them cost a conditional
  // request per page view to be told nothing had changed.
  //
  // The ceiling here is set by what these are NOT: content-hashed. The
  // runtime can be kept for a year because its URL names its bytes (see
  // core's runtimeSrcFor); none of these can say that, so the lifetime is
  // however long a wrong answer is worth tolerating after a deploy. An icon
  // that is a week stale is nothing; a stylesheet a week out of step with
  // markup that is never cached is a broken page, so those get an hour.
  //
  // The application's own layer rather than markout's, deliberately: the
  // middleware hands on what it does not serve precisely so that a site
  // keeps its static layer and the policy that goes with it.
  app.use(
    express.static(props.docroot, {
      setHeaders: (res, filePath) => {
        const forever = /\.(ico|png|jpg|jpeg|svg|webp|avif|woff2?)$/i.test(filePath);
        res.setHeader('Cache-Control', `public, max-age=${forever ? 604800 : 3600}`);
      },
    })
  );
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  // `--prod` serves what a deployed page weighs.
  //
  // Worth a flag rather than a comment somewhere: dev mode keeps every
  // expression readable, which costs about five times the props of a
  // compiled build, and this is the page anyone measuring markout will
  // reach for. Left as the only option, the easy number to get is the
  // wrong one by a factor nobody would guess.
  const dev = !process.argv.includes('--prod');
  // A count of proxies, set where the app is deployed and nowhere else, so
  // that trusting a forwarded header is something a deployment declares
  // rather than something a default decided. See SiteProps.trustProxy.
  //
  // Set but unreadable is taken as one hop and said out loud, rather than
  // ignored: whoever wrote it meant to trust their proxy, and the failure
  // that follows from quietly not doing so is a site that works, and is
  // wrong about every visitor's address and about its own scheme.
  let trustProxy: number | false = false;
  if (process.env.TRUST_PROXY) {
    const hops = Number(process.env.TRUST_PROXY);
    trustProxy = Number.isInteger(hops) && hops > 0 ? hops : 1;
    if (trustProxy !== hops) {
      console.warn(
        `TRUST_PROXY="${process.env.TRUST_PROXY}" is not a number of proxies: taking it as 1`
      );
    }
  }
  // Where the pages are. In a checkout that is here, the server sitting among
  // the files it serves; the deployed image says otherwise, because there the
  // docroot holds the site and nothing else. Everything under it is servable
  // -- that is what a docroot IS -- so a deployment that keeps its code out of
  // one cannot serve its own source by accident. See Dockerfile.
  const docroot = process.env.DOCROOT || __dirname;
  const server = createSite({ docroot, dev, trustProxy }).listen(port, () => {
    console.log(`homepage       http://127.0.0.1:${port}/`);
    console.log(`demos          http://127.0.0.1:${port}/demos/`);
    console.log(`kitchen sink   http://127.0.0.1:${port}/demos/kitchen-sink.html`);
    console.log(`orbit          http://127.0.0.1:${port}/demos/orbit.html`);
    console.log(`desk           http://127.0.0.1:${port}/demos/desk/`);
    console.log(
      dev
        ? 'mode           dev -- readable expressions, NOT representative of what a\n' +
          '               deployed page weighs. Re-run with --prod to measure.'
        : 'mode           prod -- what a deployed page weighs'
    );
  });

  // Stopping a container is a SIGTERM, and node's own handler for it exits at
  // once -- mid-response for whoever was mid-request, which during a deploy is
  // everybody currently on the site. Closing the server instead refuses new
  // connections and lets the answers in flight finish.
  //
  // The idle keep-alive connections have to be closed by hand: they are
  // holding nothing, but `close` waits for them, so without this the process
  // would sit there until the last browser lost interest. The timer is the
  // backstop for a request that never ends, and is unref'd so that it is not
  // itself a reason to stay up.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
      server.closeIdleConnections();
      setTimeout(() => process.exit(0), 10_000).unref();
    });
  }
}
