/**
 * `@markout-dev/cli` -- the `markout` command, and the two things it does,
 * available to a program that wants them without the command line.
 *
 * The bin is a thin wrapper over these: `markout <docroot>` is a `Server`
 * with three props set from flags, and `markout build` is one call to
 * `build`. An application embedding either gets what the CLI gets, which is
 * the point of the surface being here rather than inlined in `cli.ts` --
 * a project should not have to reimplement the server in order to add one
 * route to it. See ServerProps.
 *
 * `@markout-dev/express` remains the smaller dependency for an application
 * that already has a server of its own; this package is the one that brings
 * a server with it.
 *
 * Like core's and express's, this list is curated: see docs/design/monorepo.md.
 */

// serving a docroot, and everything an application can configure about it
export { Server, type ServerProps } from './server';

// compiling one ahead of time
export { build, pagePathname, type BuildProps, type BuildResult } from './server/build';

// what the bin defaults to, so an embedding agrees with the command line
export { DEFAULT_DOCROOT, DEFAULT_OUTDIR } from './defaults';
