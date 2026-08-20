/**
 * `@markout-lang/express` -- markout as Express middleware.
 *
 * This is the package an application installs when it already has a server
 * and wants markout to render its pages:
 *
 *     app.use(markout({ docroot: __dirname }));
 *
 * What it deliberately does NOT contain is a server. Listening on a port,
 * handling a signal and deciding when to exit belong to whatever owns the
 * process, which for an application is the application -- so `Server` and
 * its exit hook stay in the `markout` CLI, and nothing here installs a
 * process-level handler on a host that did not ask for one.
 *
 * Like core's, this list is curated: see docs/design/monorepo.md.
 */

// the middleware itself, and what a page request may be answered with
export {
  CLIENT_CODE_REQ,
  cspNonce,
  markout,
  resolvePath,
  type ErrorPages,
  type MarkoutProps,
} from './middleware';

// what it reports, and to whom
export { defaultLogger, type MarkoutLogger } from './logger';

// dev-mode machinery: a page that reloads itself when its source changes
export {
  createReloader,
  RELOAD_REQ,
  withReloadScript,
  type Reloader,
} from './livereload';
export { watchTree, type TreeWatcher } from './watcher';
