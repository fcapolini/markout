import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * The browser runtime on disk.
 *
 * `__dirname` is src/render (dev, via tsx) or dist/render (built); either way
 * that is exactly two levels below the package root, where esbuild puts the
 * bundle (see scripts/build-runtime.mjs).
 *
 * A distribution that REPACKAGES this code breaks that walk, and says so by
 * passing `runtimeBundle`. The VS Code extension is one: it bundles core
 * into `dist/client.js`, at which point `../../dist` is two levels above the
 * extension and names nothing. Without an override the pages compile, the
 * runtime is missing, and every one of them is inert -- the failure this
 * design is least willing to ship, because it looks like the language not
 * working.
 *
 * `MARKOUT_RUNTIME_BUNDLE` does the same for a SEPARATE PROCESS, which is
 * the case a parameter cannot reach: the extension spawns the CLI as a
 * sidecar and hands it the path in its environment. It is the fallback and
 * not the first answer, because an environment variable goes where it is
 * not wanted -- an editor extension setting one on its own process leaks it
 * into every terminal that editor opens, and a dev server started there
 * then serves the EXTENSION's runtime to pages compiled by the checkout.
 * Everything renders, nothing throws, and the browser quietly runs a
 * different version: the one mismatch runtimeSrcFor exists to prevent.
 *
 * A function and not a const, which matters more than it looks: a const is
 * evaluated when the module is loaded, and a host that bundles this code has
 * loaded it before its own `activate` runs. It could then never set the
 * variable in time.
 */
export function runtimeBundlePath(override?: string): string {
  return (
    override ||
    process.env.MARKOUT_RUNTIME_BUNDLE ||
    path.join(__dirname, '../../dist/markout-runtime.js')
  );
}

/**
 * The browser runtime, as text.
 *
 * Missing is a warning rather than a throw because a server can still be
 * useful without it -- every page renders, they just don't come alive -- and
 * the message says what to run. A BUILD treats the same absence as fatal:
 * there is nobody to read a warning about output that has already been
 * written.
 */
export function loadClientCode(override?: string): string {
  try {
    return fs.readFileSync(runtimeBundlePath(override), 'utf8');
  } catch {
    console.warn(
      `[markout] runtime bundle not found at "${runtimeBundlePath(override)}" -- run "npm run build:runtime"`
    );
    return '';
  }
}

/**
 * Where a page asks for the runtime: `/markout-runtime.<hash>.js`.
 *
 * The hash is of the bundle itself, so the URL changes exactly when the
 * bytes do -- which is what makes it safe to tell a browser to keep it for
 * a year and never ask again. A fixed path could not: it had no
 * `Cache-Control` at all, so every visit spent a conditional request to be
 * told nothing had changed, and any long lifetime on it would have served
 * a stale runtime after a deploy.
 *
 * Content rather than the package version, and this repository is its own
 * argument: the bundle changed twice in one day under `0.4.0`, between the
 * commit that set that version and the one that was published. A
 * version-stamped URL would have handed the second props contract to the
 * first runtime, which is the one mismatch that breaks every page at once.
 *
 * Eight base64url characters, which is 48 bits: enough that two different
 * bundles colliding is not a thing that happens, short enough to read.
 */
export function runtimeSrcFor(clientCode: string): string {
  const hash = createHash('sha256').update(clientCode).digest('base64url').slice(0, 8);
  return `/markout-runtime.${hash}.js`;
}

/** how long a browser may keep a URL that can never mean different bytes */
export const RUNTIME_CACHE_CONTROL = 'public, max-age=31536000, immutable';
