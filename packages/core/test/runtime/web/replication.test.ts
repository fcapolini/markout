import { parse } from '../../../src/html/parser';
import { assert, describe, it } from 'vitest';
import {
  CoreScopeProps,
  RT_FOR_EACH_VALUE,
  RT_FOR_AS_VALUE,
  RT_FOR_KEY_VALUE,
} from '../../../src/runtime/core/core-scope';
import type { RuntimeError } from '../../../src/runtime/core/core-context';
import { WebContext } from '../../../src/runtime/web/web-context';
import { WebScope } from '../../../src/runtime/web/web-scope';

// mirrors what the compiler produces for a :for-each host: a marker comment
// where the element was written, `-c<scopeId>.<stencilKey>`, and the stencil
// itself out of the way in <head>, keeping the host's own data-markout id
const HTML =
  '<html data-markout="0">' +
  '<head><template data-markout-stencil="q0"><li data-markout="1"></li></template></head>' +
  '<ul><!---c1.q0--></ul></html>';

function setup(root: CoreScopeProps, html = HTML, onError?: RuntimeError[]) {
  const source = parse(html, 'test');
  const context = new WebContext({
    doc: source.doc,
    root,
    ...(onError ? { onError: (e: RuntimeError) => onError.push(e) } : {}),
  }).refresh();
  return { source, context, host: context.root.children[0] as WebScope };
}

/** a `:for-key=${data.id}` host, i.e. what the compiler emits for it */
function keyedSetup(items: any[], onError?: RuntimeError[]) {
  return setup(
    {
      id: '0',
      values: {},
      children: [
        {
          id: '1',
          values: {
            [RT_FOR_EACH_VALUE]: { val: items },
            data: {},
            [RT_FOR_KEY_VALUE]: { exp: ($: any) => $.data.id },
          },
        },
      ],
    },
    HTML,
    onError
  );
}

/** the replica ids in document order, which is what a reorder has to fix */
function domOrder(source: any): string[] {
  return [...findByTag(source.doc, 'UL').childNodes]
    .filter((n: any) => n.tagName === 'LI' && n.getAttribute('data-markout') !== '1')
    .map((n: any) => n.getAttribute('data-markout'));
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
  it('leaves a marker where the host was written and creates real clone elements', () => {
    const { source, host } = setup({
      id: '0',
      values: {},
      children: [
        { id: '1', values: { [RT_FOR_EACH_VALUE]: { val: [10, 20, 30] }, data: {} } },
      ],
    });

    const ul = findByTag(source.doc, 'UL');
    const liTags = ul.childNodes.filter((n: any) => n.tagName === 'LI');

    // nothing but the marker and the replicas: the stencil is in <head>, so
    // `ul > li:first-child` is the first replica and `:nth-child` counts items
    assert.equal(ul.childNodes[0].nodeType, 8, 'the marker comment comes first');
    assert.equal(liTags.length, 3, '3 real clone <li>s, and no stencil among them');
    assert.equal(host.clones?.length, 3);
  });

  it('reuses an already-present element by id instead of creating a new one', () => {
    // simulates SSR: the FIRST <li> already exists in the document,
    // stamped with the id clone(0) would use (the host's own stencil
    // never represents item 0 -- clone(0) always covers it)
    const html =
      '<html data-markout="0">' +
      '<head><template data-markout-stencil="q0"><li data-markout="1"></li></template></head>' +
      '<ul><!---c1.q0--><li data-markout="1-0"></li></ul></html>';
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
    assert.equal(markup.match(/<li>/g)?.length, 5, 'the stencil in <head> + 4 real clones');
  });

  it('binds text in a clone stamped from a stencil whose markers sit side by side', () => {
    // a stencil is never bound to data, so its interpolations render empty --
    // and an empty text node serializes to nothing at all. What the browser
    // parses back is the marker pair with no text node between them, and
    // that is what every clone created after a shrink/grow is cloned from
    const html =
      '<html data-markout="0">' +
      '<head><template data-markout-stencil="q0">' +
      '<li data-markout="1"><!---t0--><!---/--></li></template></head>' +
      '<ul><!---c1.q0--></ul></html>';
    const { source, host } = setup(
      {
        id: '0',
        values: {},
        children: [
          {
            id: '1',
            values: { [RT_FOR_EACH_VALUE]: { val: [10, 20] }, data: {}, text$0: {} },
          },
        ],
      },
      html
    );

    (host.clones as WebScope[]).forEach((c, i) => (c.proxy.text$0 = `item ${i}`));

    const markup = source.doc.toString().replace(/ data-markout="[^"]*"/g, '');
    assert.include(markup, '<li><!---t0-->item 0<!---/--></li>');
    assert.include(markup, '<li><!---t0-->item 1<!---/--></li>');
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

  it('keeps a replica, and its element, with its item when a keyed list reorders', () => {
    // the point of the whole feature: reordering must MOVE replicas, not
    // rewrite each one in place, or everything the DOM itself holds stays
    // behind while the data slides out from under it
    const { source, host } = keyedSetup([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const before = [...(host.clones as WebScope[])];
    const nodes = before.map(c => c.dom);
    assert.deepEqual(domOrder(source), ['1-0', '1-1', '1-2']);

    host.proxy[RT_FOR_EACH_VALUE] = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];

    const after = host.clones as WebScope[];
    assert.deepEqual(after, [before[2], before[0], before[1]], 'same scopes, new order');
    assert.deepEqual(after.map(c => c.dom), [nodes[2], nodes[0], nodes[1]], 'same elements');
    assert.deepEqual(domOrder(source), ['1-2', '1-0', '1-1'], 'document order follows the array');
  });

  it('replicates the scope that OWNS :for-each, not the one its expression resolves in', () => {
    // a usage-site value resolves against the scope the tag was written in
    // (props.callSite), and for$each is no different -- but what it ACTS on
    // has to stay this scope. Taking the host from the value's own scope
    // instead had a component with :for-each on it replicate the scope
    // around the tag, which is not a list at all
    const { host } = setup({
      id: '0',
      values: {},
      children: [
        {
          id: '1',
          values: {
            [RT_FOR_EACH_VALUE]: { val: [10, 20, 30], callSite: true },
            data: {},
          },
        },
      ],
    });

    assert.equal(host.clones?.length, 3, 'the child replicated, not its parent');
    assert.isUndefined((host.parent as WebScope).clones, 'the call-site scope was left alone');
  });

  it('moves only the replicas that are actually out of place', () => {
    const { source, host } = keyedSetup([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const ul = findByTag(source.doc, 'UL');
    const insertBefore = ul.insertBefore.bind(ul);
    let moves = 0;
    ul.insertBefore = (n: any, ref: any) => {
      moves++;
      return insertBefore(n, ref);
    };

    // re-stating the same order must touch nothing at all
    host.proxy[RT_FOR_EACH_VALUE] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    assert.equal(moves, 0, 'no reorder, no DOM writes');

    // and rotating by one only needs `c` lifted to the front: re-inserting a
    // node that already sits where it belongs is still a remove-and-reinsert,
    // which is precisely what drops focus and restarts a transition
    host.proxy[RT_FOR_EACH_VALUE] = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
    assert.equal(moves, 1);
    assert.deepEqual(domOrder(source), ['1-2', '1-0', '1-1']);
  });

  it('keeps a replica id with its item rather than with its position', () => {
    // pages build HTML ids out of $id (aria-controls, a label's `for`), so an
    // id that stayed with the slot would silently point at a different item
    // after every move
    const { host } = keyedSetup([{ id: 'a' }, { id: 'b' }]);
    const idOfB = (host.clones![1] as WebScope).proxy.$id;
    assert.equal(idOfB, '1-1');

    host.proxy[RT_FOR_EACH_VALUE] = [{ id: 'b' }, { id: 'a' }];
    assert.equal((host.clones![0] as WebScope).proxy.$id, idOfB, 'b kept its own id');
  });

  it('creates replicas for new keys and disposes the ones whose key is gone', () => {
    const { source, host } = keyedSetup([{ id: 'a' }, { id: 'b' }]);
    const a = host.clones![0] as WebScope;

    host.proxy[RT_FOR_EACH_VALUE] = [{ id: 'a' }, { id: 'c' }];
    assert.equal(host.clones!.length, 2);
    assert.equal(host.clones![0], a, 'a survived untouched');
    // a fresh index rather than the disposed replica's: reusing it would put
    // b's old id on an unrelated item, which is what stable ids rule out
    assert.deepEqual(domOrder(source), ['1-0', '1-2']);
  });

  it('reports a duplicate key, and still renders every item', () => {
    const errors: RuntimeError[] = [];
    const { source, host } = keyedSetup([{ id: 'a' }, { id: 'a' }], errors);

    assert.equal(host.clones!.length, 2, 'both items rendered');
    assert.deepEqual(domOrder(source), ['1-0', '1-1']);
    assert.deepEqual(
      errors.map(e => [e.scope, e.key, e.message]),
      [['1', RT_FOR_KEY_VALUE, 'duplicate :for-key "a"']]
    );
  });

  it('leaves an unkeyed list updating in place, as before', () => {
    // the contrast that makes the keyed path worth having: without a key the
    // replica belongs to the slot, so a reorder rewrites data into the same
    // scopes and the same elements, in the same order
    const { source, host } = setup({
      id: '0',
      values: {},
      children: [
        { id: '1', values: { [RT_FOR_EACH_VALUE]: { val: [10, 20, 30] }, data: {} } },
      ],
    });
    const before = [...(host.clones as WebScope[])];

    host.proxy[RT_FOR_EACH_VALUE] = [30, 10, 20];

    assert.deepEqual(host.clones, before, 'same scopes in the same slots');
    assert.deepEqual(domOrder(source), ['1-0', '1-1', '1-2'], 'nothing moved');
    assert.deepEqual((host.clones as WebScope[]).map(c => c.proxy.data), [30, 10, 20]);
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
