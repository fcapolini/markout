import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/render/render';

/**
 * One compiled page, rendered again and again.
 *
 * This is what the middleware does: a page is compiled once and its document
 * is written into per request, which is what makes a second visitor cost a
 * render rather than a compile. Almost everything about that document is put
 * back or written over between renders -- stencils are restored, a region
 * that must not show is hidden by its own condition, text is replaced in
 * place.
 *
 * A `:for-each` was the exception, because the two renders never meet: each
 * builds a fresh scope tree from the props, so the second knows nothing of
 * the first's replicas. It stamped `s4-0`, found the element already
 * standing and adopted it, and `s4-1` onward belonged to nobody -- so a
 * shorter array than last time left the difference in the page.
 *
 * Found by building an application (sites/shop): a filtered catalog showed
 * the ten items of the request before it, two of them right. In a catalog
 * that is a wrong count; keyed to a person it is one visitor's rows in
 * another's page, and nothing about it is loud.
 */
let docroot: string;
beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-rerender-'));
});
afterAll(() => {
  fs.rmSync(docroot, { recursive: true, force: true });
});

describe('a list that is shorter than it was last time', () => {
  it('leaves nothing of the render before it', async () => {
    fs.writeFileSync(
      path.join(docroot, 'p.html'),
      '<html><body :server-rows=${globalThis.__rows}>' +
        '<i :for-each=${rows} :for-as="r">${r}</i></body></html>'
    );
    // one compile, many renders, exactly as the middleware holds it
    const page = await new Compiler({ docroot }).compile('/p.html');
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    const rows = (): string[] => {
      const body = /<body[\s\S]*?<script/.exec(page.source.doc.toString())?.[0] ?? '';
      return [...body.replace(/<!---[^>]*-->/g, '').matchAll(/<i[^>]*>([^<]*)<\/i>/g)].map(
        m => m[1]
      );
    };
    const render = async (items: string[]) => {
      (globalThis as unknown as { __rows: string[] }).__rows = items;
      expect(await renderPage(page)).toStrictEqual([]);
      return rows();
    };

    expect(await render(['a', 'b', 'c', 'd'])).toStrictEqual(['a', 'b', 'c', 'd']);
    expect(await render(['x'])).toStrictEqual(['x']);
    expect(await render([])).toStrictEqual([]);
    // and back up, so the sweep is not merely truncating what it finds
    expect(await render(['p', 'q'])).toStrictEqual(['p', 'q']);
  });
});
