import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Everything the site publishes reaches the image, and is findable once it does.
 *
 * The image's docroot is an ALLOW-LIST of named files rather than a copied
 * directory, and deliberately so -- the comment above it in the Dockerfile
 * gives the reason, which is that a docroot serves everything under it and a
 * deployment should not be able to serve its own sources by accident. The
 * cost of that choice is this: a file added to the repository is not on
 * markout.dev until somebody names it there.
 *
 * That failure is the quiet kind. It works in the dev server, it works under
 * `markout build`, the suite stays green, and it 404s only in production --
 * which is what `about.html` did on the day it was written, with a navbar
 * item and a footer link already pointing at it.
 *
 * **The list below is of what is NOT published**, which is the way round that
 * fails safely. A list of what IS would have to name every extension anybody
 * might add -- a `.webmanifest`, a `.woff2`, an `apple-touch-icon.png` -- and
 * would quietly ignore the one nobody thought of, which is the whole failure
 * being guarded against. This way an unrecognised file is assumed to be part
 * of the site and says so, and the cost of being wrong is one line here
 * rather than a dead URL nobody notices.
 *
 * Only the top level: `/demos`, `/examples` and `/parts` are copied whole, so
 * anything added under them is already deployed by the line that is there.
 */

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'sites', 'site');

/** repository files that live beside the site without being part of it */
const NOT_SERVED = new Set([
  'CHANGELOG.md',
  'DEPLOY.md',
  'Dockerfile',
  'README.md',
  'package.json',
  'tsconfig.build.json',
  'tsconfig.json',
]);

/** and `.ts` anywhere in it is source: the image deletes any that reaches the docroot */
const isSource = (name: string) => name.endsWith('.ts');

const published = fs
  .readdirSync(SITE, { withFileTypes: true })
  .filter(e => e.isFile())
  .map(e => e.name)
  .filter(name => !name.startsWith('.') && !NOT_SERVED.has(name) && !isSource(name))
  .sort();

const dockerfile = fs.readFileSync(path.join(SITE, 'Dockerfile'), 'utf8');
const copied = [
  ...dockerfile.matchAll(/^COPY\s+(.+?)\s+\.\/public\/$/gm),
].flatMap(m => m[1].split(/\s+/).map(p => path.basename(p)));

describe('the site is deployed as it is written', () => {
  it('finds files to check', () => {
    // a guard on the guard: a glob matching nothing would pass everything
    expect(published.length).toBeGreaterThan(0);
    expect(published).toContain('index.html');
  });

  it.each(published)('copies %s into the image docroot', name => {
    expect(
      copied,
      `${name} is not copied into the docroot: add it to a "COPY ... ./public/" ` +
        'line in sites/site/Dockerfile, or to NOT_SERVED in this test if it is ' +
        'a repository file rather than part of the site'
    ).toContain(name);
  });

  it('names nothing that is gone', () => {
    // the other direction, which breaks the image build rather than a URL
    for (const name of copied) {
      expect(fs.existsSync(path.join(SITE, name)), `${name} is copied but missing`).toBe(true);
    }
  });

  const sitemap = fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
  const pages = published.filter(name => name.endsWith('.html'));

  it.each(pages)('lists %s in the sitemap', page => {
    // the homepage is the bare origin there, not `/index.html`
    const url = page === 'index.html' ? 'https://markout.dev/' : `https://markout.dev/${page}`;
    expect(sitemap, `${page} is not in sitemap.xml, which is kept by hand`).toContain(
      `<loc>${url}</loc>`
    );
  });
});
