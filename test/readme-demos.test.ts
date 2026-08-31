import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * "The README, running" is running the README.
 *
 * `sites/site/demos/readme/` is listed on the demos page as "Every example
 * from the README as a page you can open", and it keeps that promise by
 * holding a COPY of each one. A copy drifts: the reactivity example was
 * edited in the README -- `count` moved from `<html>` to `<body>`, which is
 * the entire point the surrounding prose now makes -- and the page a reader
 * would have opened to see it still showed the old shape, with nothing
 * failing anywhere.
 *
 * Nothing was checking it, and the two suites that look like they would do
 * not. `readme-blocks.test.ts` compiles the README's own blocks; the demo
 * suites serve the demo; neither compares them, so a demo can go on being a
 * correct page that is no longer the example it claims to be.
 *
 * Whitespace is normalised because indentation inside a fenced block is the
 * markdown's business, and the `<!-- lib.htm -->` marker a fragment block
 * carries is dropped -- it is how `readme-blocks.test.ts` recognises which
 * file a block stands for, and it is not part of the file.
 */

const ROOT = path.resolve(__dirname, '..');
const DEMO = path.join(ROOT, 'sites', 'site', 'demos', 'readme');

/** the demo's own index, which lists the others and is nobody's example */
const NOT_AN_EXAMPLE = new Set(['index.html']);

const FRAGMENT_MARKER = /^\s*<!--\s*[\w.-]+\.htm\s*-->\s*/;

const normalize = (text: string) =>
  text.replace(FRAGMENT_MARKER, '').replace(/\s+/g, ' ').trim();

const readmeBlocks = [
  ...fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').matchAll(/```html\n([\s\S]*?)```/g),
].map(m => normalize(m[1]));

const mirrored = fs
  .readdirSync(DEMO)
  .filter(name => !NOT_AN_EXAMPLE.has(name) && /\.html?$|\.htm$/.test(name))
  .sort();

describe('the README demos are the README', () => {
  it('finds both sides to compare', () => {
    // a guard on the guard: two empty lists agree about everything
    expect(mirrored.length).toBeGreaterThan(0);
    expect(readmeBlocks.length).toBeGreaterThan(0);
  });

  it.each(mirrored)('%s is verbatim an example in the README', name => {
    const demo = normalize(fs.readFileSync(path.join(DEMO, name), 'utf8'));
    expect(
      readmeBlocks,
      `sites/site/demos/readme/${name} is no longer any example in README.md. ` +
        'The demos page offers these as the README\'s examples, so one of the two ' +
        'has to move.'
    ).toContain(demo);
  });
});
