import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Every top-level page of the site is deployed, and is findable once it is.
 *
 * The image's docroot is an ALLOW-LIST of named files rather than a copied
 * directory, and deliberately so -- the comment above it in the Dockerfile
 * gives the reason, which is that a docroot serves everything under it and a
 * deployment should not be able to serve its own sources by accident. The
 * cost of that choice is this: a page added to the repository is not a page
 * on markout.dev until somebody names it there.
 *
 * That failure is the quiet kind. The page works in the dev server, it works
 * in `markout build`, the suite stays green, and the link 404s only in
 * production -- which is exactly what `about.html` did on the day it was
 * written, with a nav item and a footer link already pointing at it.
 *
 * Only the top level is checked, because only the top level is listed by
 * hand: `/demos` and `/examples` are copied whole, so a page added under
 * either is deployed by the line that is already there.
 */

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'sites', 'site');

const pages = fs
  .readdirSync(SITE)
  .filter(name => name.endsWith('.html'))
  .sort();

describe('the site is deployed as it is written', () => {
  it('finds the pages to check', () => {
    // a guard on the guard: a glob that matches nothing passes everything
    expect(pages.length).toBeGreaterThan(0);
    expect(pages).toContain('index.html');
  });

  const dockerfile = fs.readFileSync(path.join(SITE, 'Dockerfile'), 'utf8');
  const copied = new Set(
    [...dockerfile.matchAll(/^COPY\s+(.+?)\s+\.\/public\/$/gm)]
      .flatMap(m => m[1].split(/\s+/))
      .map(p => path.basename(p))
  );

  it.each(pages)('copies %s into the image docroot', page => {
    expect(copied).toContain(page);
  });

  const sitemap = fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');

  it.each(pages)('lists %s in the sitemap', page => {
    // the homepage is the bare origin there, not `/index.html`
    const url = page === 'index.html' ? 'https://markout.dev/' : `https://markout.dev/${page}`;
    expect(sitemap).toContain(`<loc>${url}</loc>`);
  });
});
