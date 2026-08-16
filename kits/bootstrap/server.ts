/**
 * The Bootstrap kit's dev server.
 *
 * The showcase (`index.html`) needs nothing but a docroot; Orbit
 * (`demo.html`) reads its data from a database, and there is nowhere on a
 * command line to put one of those. So the kit brings its own entry point,
 * which is also the honest picture: markout is middleware, and an
 * application is the thing that has the services.
 *
 *     npm run dev:bootstrap-kit
 */
import path from 'path';
import { Server } from '../../src/server';
import { openOperationsDb } from './orbit-db';

new Server({
  docroot: __dirname,
  port: Number(process.env.PORT) || 3000,
  dev: true,
  compress: true,
  // Named here and reachable as `db` from any `:server-` value, and from
  // nowhere else -- the compiler is told the name and refuses it anywhere
  // the browser would go, so nothing has to be guarded at runtime.
  globals: { db: openOperationsDb() },
}).start();
