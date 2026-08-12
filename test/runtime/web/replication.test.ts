import { parse } from '../../../src/html/parser';
import { assert, describe, it } from 'vitest';
import { CoreScopeProps, RT_FOR_EACH_VALUE, RT_FOR_AS_VALUE } from '../../../src/runtime/core/core-scope';
import { WebContext } from '../../../src/runtime/web/web-context';
import { WebScope } from '../../../src/runtime/web/web-scope';

// mirrors what stage1-load produces for a :for-each host: the stencil
// element lives inside a <template>, keeping its own data-markout id
const HTML =
  '<html data-markout="0"><ul><template><li data-markout="1"></li></template></ul></html>';

function setup(root: CoreScopeProps, html = HTML) {
  const source = parse(html, 'test');
  const context = new WebContext({ doc: source.doc, root }).refresh();
  return { source, context, host: context.root.children[0] as WebScope };
}

function findByTag(root: any, tagName: string): any {
  for (const n of root.childNodes ?? []) {
    if (n.tagName === tagName) return n;
    const found = findByTag(n, tagName);
    if (found) return found;
  }
  return undefined;
}

describe('replication: DOM cloning/reuse', () => {
  it('turns the stencil into an inert <template> and creates real clone elements', () => {
    const { source, host } = setup({
      id: '0',
      values: {},
      children: [
        { id: '1', values: { [RT_FOR_EACH_VALUE]: { val: [10, 20, 30] }, data: {} } },
      ],
    });

    const ul = findByTag(source.doc, 'UL');
    const liTags = ul.childNodes.filter((n: any) => n.tagName === 'TEMPLATE' || n.tagName === 'LI');

    assert.equal(liTags[0].tagName, 'TEMPLATE');
    assert.equal(liTags.length, 4, 'template stencil + 3 real clone <li>s');
    assert.equal(host.clones?.length, 3);
  });

  it('reuses an already-present element by id instead of creating a new one', () => {
    // simulates SSR: the FIRST <li> already exists in the document,
    // stamped with the id clone(0) would use (the host's own stencil
    // never represents item 0 -- clone(0) always covers it)
    const html =
      '<html data-markout="0"><ul>' +
      '<template><li data-markout="1"></li></template>' +
      '<li data-markout="1-0"></li>' +
      '</ul></html>';
    const source = parse(html, 'test');
    const ul = findByTag(source.doc, 'UL');
    const preexisting = ul.childNodes.find((n: any) => n.getAttribute?.('data-markout') === '1-0');

    const context = new WebContext({
      doc: source.doc,
      root: {
        id: '0',
        values: {},
        children: [
          { id: '1', values: { [RT_FOR_EACH_VALUE]: { val: [10] }, data: {} } },
        ],
      },
    }).refresh();

    const host = context.root.children[0] as WebScope;
    assert.equal(host.clones?.length, 1);
    assert.equal((host.clones![0] as WebScope).dom, preexisting, 'the SSR-rendered element is reused, not replaced');
  });

  it('falls back to cloneNode(true) + insertion when growing beyond what already exists', () => {
    const { source, host } = setup({
      id: '0',
      values: {},
      children: [
        { id: '1', values: { [RT_FOR_EACH_VALUE]: { val: [10, 20] }, data: {} } },
      ],
    });
    assert.equal(host.clones?.length, 2);

    host.proxy[RT_FOR_EACH_VALUE] = [10, 20, 30, 40];
    assert.equal(host.clones?.length, 4);

    const markup = source.doc.toString().replace(/ data-markout="[^"]*"/g, '');
    assert.equal(markup.match(/<li>/g)?.length, 5, 'template stencil + 4 real clones');
  });

  it('removes a clone\'s DOM element when the array shrinks', () => {
    const { source, host } = setup({
      id: '0',
      values: {},
      children: [
        { id: '1', values: { [RT_FOR_EACH_VALUE]: { val: [10, 20, 30] }, data: {} } },
      ],
    });
    assert.equal(host.clones?.length, 3);

    host.proxy[RT_FOR_EACH_VALUE] = [10];
    assert.equal(host.clones?.length, 1);

    const markup = source.doc.toString().replace(/ data-markout="[^"]*"/g, '');
    assert.equal(markup.match(/<li>/g)?.length, 2, 'inert stencil + the one remaining real clone');
  });

  it('removes ALL clones when the array becomes null/undefined, leaving nothing visible', () => {
    const { source, host } = setup({
      id: '0',
      values: {},
      children: [
        { id: '1', values: { [RT_FOR_EACH_VALUE]: { val: [10, 20, 30] }, data: {} } },
      ],
    });
    assert.equal(host.clones?.length, 3);

    host.proxy[RT_FOR_EACH_VALUE] = null;
    assert.equal(host.clones?.length, 0);

    const markup = source.doc.toString().replace(/ data-markout="[^"]*"/g, '');
    assert.equal(markup.match(/<li>/g)?.length, 1, 'only the inert stencil remains');
  });

  it('honors a custom :for-as-style alias name for the DOM-bound data too', () => {
    const { host } = setup({
      id: '0',
      values: {},
      children: [
        {
          id: '1',
          values: {
            [RT_FOR_EACH_VALUE]: { val: ['a', 'b'] },
            [RT_FOR_AS_VALUE]: { val: 'item' },
            item: {},
          },
        },
      ],
    });

    assert.deepEqual(
      (host.clones as WebScope[]).map(c => c.proxy.item),
      ['a', 'b']
    );
  });
});
