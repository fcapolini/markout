import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from '@markout-lang/core';

/**
 * The Tailwind demo's stylesheet is complete.
 *
 * This exists because of a failure that reported nothing: a `:class-` toggle
 * spells its utility in the attribute NAME, which no CSS generator can see,
 * so the class went on the element and no rule was ever generated for it.
 * The page compiled clean, ran clean, and looked identical. The first build
 * of this demo lost five utilities that way, and would have kept losing them
 * silently -- see docs/design/tailwind-support.md.
 *
 * So the invariant under test is the one that was violated: **every class
 * this page can wear has a rule in the stylesheet it ships**. Both halves of
 * "can wear" are checked, because they go missing for different reasons:
 *
 * - the toggles, asked of the COMPILER rather than recovered by a regex over
 *   the source. A regex would be a second implementation of "what counts as
 *   a class toggle", in a different language from the one that decides -- two
 *   implementations of one rule, which is a shape this project keeps a list
 *   of, and one that fails in the same direction as the bug it guards.
 * - the literals, sampled off the RENDERED page. A sample rather than a proof,
 *   deliberately: a scanner finds literals natively, so asking the compiler to
 *   enumerate them too would be bytes buying nothing, and at the boundary case
 *   -- a name assembled from pieces -- an IR walk has no advantage over the
 *   scanner, since both are hunting string literals. What this half guards is
 *   whether the page is still being SCANNED AT ALL, and for that a sample
 *   suffices: if `@source` stopped naming the page, some literal goes missing.
 *
 * No Tailwind in the test path. `build.css` is committed and this checks the
 * bytes that ship, so the failure it catches is the real one: somebody adds a
 * toggle and does not re-run `npm run build:tailwind`.
 */
describe('the tailwind demo', () => {
  const docroot = path.resolve(__dirname, '../../../../sites/site');
  const page = '/demos/tailwind/index.html';
  const cssPath = path.join(docroot, 'demos/tailwind/build.css');
  let outdir: string;
  let css: string;

  beforeAll(async () => {
    outdir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'markout-tw-'));
    css = await fs.promises.readFile(cssPath, 'utf8');
  });

  afterAll(async () => {
    await fs.promises.rm(outdir, { recursive: true, force: true });
  });

  /**
   * Whether the stylesheet has a rule for a class.
   *
   * Tailwind escapes the characters a CSS selector cannot hold literally, so
   * `px-2.5` is written `.px-2\.5` and `md:grid-cols-3` is `.md\:grid-cols-3`.
   * The trailing guard is what keeps `p-1` from matching `.p-12`.
   */
  function hasRule(name: string): boolean {
    const selector = '.' + name.replace(/[.:/[\]()#%,+*~^$|!'"<>=@&{}?\\]/g, c => '\\' + c);
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, c => '\\' + c);
    return new RegExp(escaped + '(?![\\w-])').test(css);
  }

  it('the compiler reports the classes the page can toggle', async () => {
    const result = await build({
      docroot,
      outdir,
      pages: [page],
      classesOnly: true,
    });
    expect(result.errors).toEqual([]);
    // not an empty assertion by accident: a page with no toggles would pass
    // every check below while testing nothing
    expect(result.classes!.length).toBeGreaterThan(0);
    expect(result.pages).toEqual([]);
    expect(fs.existsSync(path.join(outdir, '_classes.html'))).toBe(true);
  });

  it('every toggled class has a rule in the committed stylesheet', async () => {
    const result = await build({
      docroot,
      outdir,
      pages: [page],
      classesOnly: true,
    });
    const missing = result.classes!.filter(name => !hasRule(name));
    expect(
      missing,
      `no CSS for ${missing.join(', ')} -- run "npm run build:tailwind"`
    ).toEqual([]);
  });

  it('the stylesheet covers what the page actually renders', async () => {
    const result = await build({
      docroot,
      outdir,
      pages: [page],
      classManifest: true,
    });
    expect(result.errors).toEqual([]);
    expect(result.serverErrors).toEqual([]);
    const html = await fs.promises.readFile(path.join(outdir, page), 'utf8');
    const rendered = new Set<string>();
    for (const [, value] of html.matchAll(/\sclass="([^"]*)"/g)) {
      value.split(/\s+/).forEach(name => name && rendered.add(name));
    }
    expect(rendered.size).toBeGreaterThan(0);
    const missing = [...rendered].filter(name => !hasRule(name));
    expect(
      missing,
      `no CSS for ${missing.join(', ')} -- run "npm run build:tailwind"`
    ).toEqual([]);
  });

  it('the manifest travels with the built page', async () => {
    const result = await build({
      docroot,
      outdir,
      pages: [page],
      classManifest: true,
    });
    const html = await fs.promises.readFile(path.join(outdir, page), 'utf8');
    const manifest = html.match(
      /<template data-markout-classes><div class="([^"]*)"><\/div><\/template>/
    );
    expect(manifest).not.toBeNull();
    // the same set the compiler reported, so a scanner reading only the
    // output learns exactly what a scanner reading the source cannot
    expect(manifest![1].split(' ').sort()).toEqual(result.classes);
  });

  it('a page with no toggles gets no manifest', async () => {
    // the byte-for-byte promise: a project that never toggles a class pays
    // nothing for a feature it is not using
    const result = await build({
      docroot,
      outdir,
      pages: ['/demos/readme/index.html'],
      classManifest: true,
    });
    expect(result.errors).toEqual([]);
    const html = await fs.promises.readFile(
      path.join(outdir, '/demos/readme/index.html'),
      'utf8'
    );
    result.classes?.length || expect(html).not.toContain('data-markout-classes');
  });
});
