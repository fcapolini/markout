import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

// __dirname is src/server (dev, via tsx) or dist/server (built); either way
// this is exactly two levels below the project root, where esbuild puts the
// bundle (see scripts/build-runtime.mjs)
export const RUNTIME_BUNDLE_PATH = path.join(__dirname, '../../dist/markout-runtime.js');

/**
 * The browser runtime, as text.
 *
 * Missing is a warning rather than a throw because a server can still be
 * useful without it -- every page renders, they just don't come alive -- and
 * the message says what to run. A BUILD treats the same absence as fatal:
 * there is nobody to read a warning about output that has already been
 * written.
 */
export function loadClientCode(): string {
  try {
    return fs.readFileSync(RUNTIME_BUNDLE_PATH, 'utf8');
  } catch {
    console.warn(
      `[markout] runtime bundle not found at "${RUNTIME_BUNDLE_PATH}" -- run "npm run build:runtime"`
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
