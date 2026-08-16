/**
 * The whole of what an application adds: a server that hands markout its
 * services.
 *
 * The CLI cannot do this -- there is nowhere on a command line to put a
 * database handle -- which is why this example brings its own entry point
 * rather than living in `demo/`.
 *
 *     npm run dev:services
 */
import path from 'path';
import { Server } from '../../src/server';
import { openDatabase } from './db';

new Server({
  docroot: path.join(__dirname, 'public'),
  port: Number(process.env.PORT) || 3000,
  dev: true,
  // Named here, reachable as `db` from any `:server-` value, and from
  // nowhere else: the compiler is told the name and refuses it anywhere the
  // browser would go. Nothing is shipped, so nothing has to be guarded at
  // runtime.
  globals: { db: openDatabase() },
}).start();
