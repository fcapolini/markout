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
 */
import compression from "compression";
import express, { type Express } from 'express';
import { markout } from '@markout-lang/express';
import { deskApi } from './demos/desk/api';

export interface SiteProps {
  docroot: string;
  /** surface runtime expression errors in the page */
  dev?: boolean;
}

export function createSite(props: SiteProps): Express {
  const app = express();
  app.use(compression());

  // -------------------------------------------------------- the service
  //
  // One demo's own back end, mounted under the pages that read it. Markout
  // knows nothing about it; it is here first because whoever answers first
  // wins, and these paths are the application's.
  app.use('/demos/desk/api', deskApi());

  // ------------------------------------------------------------ the pages
  app.use(markout({ docroot: props.docroot, dev: props.dev }));
  app.use(express.static(props.docroot));
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
  createSite({ docroot: __dirname, dev }).listen(port, () => {
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
}
