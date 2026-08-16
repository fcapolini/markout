/**
 * The Bootstrap kit's dev server, and Orbit's back end.
 *
 * Not markout's own `Server` class but a plain Express app, because Orbit is
 * a whole application: it has an API of its own, and markout is the
 * middleware that renders its pages. The order below is the arrangement --
 * the application's routes first, then markout, then static files.
 *
 *     npm run dev:bootstrap-kit
 *
 * Serves `/index.html` (the component showcase) and `/orbit.html` (app demo).
 *
 * Exported as a factory as well as run directly, so the kit's tests drive
 * the same routes the browser gets rather than a second copy of them.
 */
import compression from "compression";
import express, { type Express } from 'express';
import { markout } from '../../src/server/middleware';
import { openOperationsDb, type OperationsDb } from './orbit-db';

export interface OrbitAppProps {
  docroot: string;
  db?: OperationsDb;
  /** surface runtime expression errors in the page */
  dev?: boolean;
}

export function createOrbitApp(props: OrbitAppProps): Express {
  const db = props.db ?? openOperationsDb();
  const app = express();
  app.use(compression());
  
  // -------------------------------------------------------------- the API
  //
  // What any application has, and markout knows nothing about. Orbit's page
  // reaches these through `std-data`, which fetches them WHILE THE PAGE
  // RENDERS -- so the console arrives complete and the browser asks for
  // nothing.
  app.get('/api/services', async (_req, res) => res.json(await db.services.all()));
  app.get('/api/deploys', async (_req, res) => res.json(await db.deploys.recent()));
  app.get('/api/activity', async (_req, res) => res.json(await db.activity.feed()));
  app.get('/api/todos', async (_req, res) => res.json(await db.todos.open()));

  app.get('/api/metrics/:name', async (req, res) => {
    const metrics = db.metrics as unknown as Record<string, () => Promise<unknown>>;
    const read = metrics[req.params.name];
    read ? res.json(await read()) : res.sendStatus(404);
  });

  // The one endpoint whose answer depends on another's: which incidents
  // matter is decided by which services are unwell, so the page cannot ask
  // for these until it has the first reply. In orbit.html that is two
  // `std-data` elements and one expression joining them.
  app.get('/api/incidents', async (req, res) => {
    const ids = `${req.query.services ?? ''}`.split(',').filter(s => s);
    res.json(await db.incidents.forServices(ids));
  });

  // ------------------------------------------------------------ the pages
  app.use(markout({ docroot: props.docroot, dev: props.dev }));
  app.use(express.static(props.docroot));
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createOrbitApp({ docroot: __dirname, dev: true }).listen(port, () => {
    console.log(`bootstrap kit  http://127.0.0.1:${port}/index.html`);
    console.log(`orbit          http://127.0.0.1:${port}/orbit.html`);
  });
}
