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
