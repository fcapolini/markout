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

  /**
   * The other half of the same problem: not a list that shrank, but a
   * region that showed.
   *
   * `acquireRegionDom` decides a region is showing by looking for its
   * element next to its marker -- which is exactly where the LAST render
   * left one. And the condition does not correct it, because a region
   * toggles on change and a fresh scope tree starts at `undefined`: a
   * condition that is falsy again never moves, so no callback runs.
   *
   * What that serves is the previous request's content inside this one's
   * page, and an error for every expression in a branch that was never
   * meant to be evaluated against this request's data. Found on the shop's
   * product page, where `?id=nope` answered 404 with the product the
   * previous visitor had been looking at.
   */
  it('shows nothing of a branch that showed for the request before', async () => {
    fs.writeFileSync(
      path.join(docroot, 'b.html'),
      '<html><body :server-thing=${globalThis.__thing}>' +
        '<:group :server-if=${thing}><p>${thing.name}</p></:group>' +
        '<span :if=${thing}>${thing.name}</span>' +
        '<:group :if=${thing}><b>${thing.name}</b></:group>' +
        '</body></html>'
    );
    const page = await new Compiler({ docroot }).compile('/b.html');
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    const render = async (thing: unknown) => {
      (globalThis as unknown as { __thing: unknown }).__thing = thing;
      const errors = await renderPage(page);
      const body = /<body[\s\S]*?<script/.exec(page.source.doc.toString())?.[0] ?? '';
      return { errors: errors.map(e => `${e.msg}`), body: body.replace(/<!---[^>]*-->/g, '') };
    };

    expect((await render(undefined)).body).not.toContain('secret');
    const shown = await render({ name: 'secret' });
    expect(shown.errors).toStrictEqual([]);
    expect(shown.body).toContain('secret');

    // and now the request that must not see it
    const after = await render(undefined);
    expect(after.body).not.toContain('secret');
    // nor evaluate a branch it is not showing, which is the same fact
    expect(after.errors).toStrictEqual([]);

    // still works when it comes back, so this is emptying and not breaking
    expect((await render({ name: 'again' })).body).toContain('again');
  });

  /**
   * The same bug, in the one shape the first fix could not see.
   *
   * A `<:group>` replica is not an element: it is a run of siblings between
   * a start marker and an end marker, so there is no id to look up and the
   * sweep found nothing, concluded there was nothing left, and stopped --
   * on the first replica it was meant to remove.
   *
   * Also found by using sites/shop: a cart with two lines in it, one line
   * removed, served two lines with the survivor printed twice.
   */
  it('leaves nothing of a group replica either', async () => {
    fs.writeFileSync(
      path.join(docroot, 'g.html'),
      '<html><body :server-rows=${globalThis.__grows}>' +
        '<:group :for-each=${rows} :for-as="r" :for-key=${r}>' +
        '<i>${r}</i><b>${r}!</b>' +
        '</:group></body></html>'
    );
    const page = await new Compiler({ docroot }).compile('/g.html');
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    const shown = (tag: string): string[] => {
      const body = /<body[\s\S]*?<script/.exec(page.source.doc.toString())?.[0] ?? '';
      return [
        ...body
          .replace(/<!---[^>]*-->/g, '')
          .matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'g')),
      ].map(m => m[1]);
    };
    const render = async (items: string[]) => {
      (globalThis as unknown as { __grows: string[] }).__grows = items;
      expect(await renderPage(page)).toStrictEqual([]);
      return shown('i');
    };

    expect(await render(['a', 'b', 'c'])).toStrictEqual(['a', 'b', 'c']);
    // the reported case: the first of two removed, and the list has to shorten
    expect(await render(['b', 'c'])).toStrictEqual(['b', 'c']);
    expect(await render(['c'])).toStrictEqual(['c']);
    // both nodes of the run go, not just the one that was looked for
    expect(shown('b')).toStrictEqual(['c!']);
    expect(await render([])).toStrictEqual([]);
    expect(shown('b')).toStrictEqual([]);
    expect(await render(['p', 'q'])).toStrictEqual(['p', 'q']);
    expect(shown('b')).toStrictEqual(['p!', 'q!']);
  });
});
