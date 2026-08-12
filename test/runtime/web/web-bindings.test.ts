import { parse } from '../../../src/html/parser';
import { assert, describe, expect, it, vi } from 'vitest';
import { CoreScopeProps } from '../../../src/runtime/core/core-scope';
import type { RuntimeError } from '../../../src/runtime/core/core-context';
import { WebContext } from '../../../src/runtime/web/web-context';
import { WebScope } from '../../../src/runtime/web/web-scope';

/**
 * The value-key prefixes are the contract between the compiler, which emits
 * them, and the runtime, which gives them meaning. These state the rules per
 * prefix rather than pinning one example each.
 */
function setup(html: string, root: CoreScopeProps, onError?: RuntimeError[]) {
  const source = parse(html, 'test');
  const context = new WebContext({
    doc: source.doc,
    root,
    ...(onError ? { onError: (e: RuntimeError) => onError.push(e) } : {}),
  }).refresh();
  const markup = () => {
    // the ids are noise in the assertions
    const s = source.doc.toString();
    return s.replace(/ data-markout="\d+"/g, '');
  };
  return { source, context, scope: context.root as WebScope, markup };
}

const ROOT = '<html data-markout="0"></html>';

describe('attr$', () => {
  it('sets and updates an attribute', () => {
    const { context, markup } = setup(ROOT, {
      id: '0',
      values: { attr$lang: { val: 'en' } },
    });
    assert.include(markup(), '<html lang="en">');
    context.root.proxy.attr$lang = 'it';
    assert.include(markup(), '<html lang="it">');
  });

  it('removes the attribute when the value is nullish', () => {
    const { context, markup } = setup(ROOT, {
      id: '0',
      values: { attr$lang: { val: 'en' } },
    });
    context.root.proxy.attr$lang = null;
    assert.notInclude(markup(), 'lang');
  });

  it('converts camelCase keys to dashed attribute names', () => {
    const { markup } = setup(ROOT, {
      id: '0',
      values: { attr$dataFooBar: { val: '1' } },
    });
    assert.include(markup(), 'data-foo-bar="1"');
  });
});

describe('class$', () => {
  it('adds the class when truthy and removes it when falsy', () => {
    const { context, markup } = setup(ROOT, {
      id: '0',
      values: { class$active: { val: true } },
    });
    assert.include(markup(), 'class="active"');
    context.root.proxy.class$active = false;
    assert.notInclude(markup(), 'active');
  });

  it('supports dashed multi-word class names verbatim', () => {
    const { markup } = setup(ROOT, {
      id: '0',
      values: { 'class$is-active': { val: true } },
    });
    assert.include(markup(), 'class="is-active"');
  });
});

describe('style$', () => {
  it('sets and clears a style property', () => {
    const { context, markup } = setup(ROOT, {
      id: '0',
      values: { style$color: { val: 'red' } },
    });
    assert.include(markup(), 'style="color: red;"');
    context.root.proxy.style$color = null;
    assert.notInclude(markup(), 'color');
  });

  it('supports dashed multi-word property names verbatim', () => {
    const { markup } = setup(ROOT, {
      id: '0',
      values: { 'style$background-color': { val: 'blue' } },
    });
    assert.include(markup(), 'background-color: blue;');
  });
});

describe('prop$', () => {
  it('assigns the element property, writing nothing into the markup', () => {
    const items = ['a', 'b'];
    const { context, scope, markup } = setup(ROOT, {
      id: '0',
      values: { 'prop$items': { val: items } },
    });
    // what an attribute can't carry: the array arrives by reference
    assert.strictEqual((scope.dom as any).items, items);
    assert.notInclude(markup(), 'items');

    context.root.proxy['prop$items'] = ['c'];
    assert.deepEqual((scope.dom as any).items, ['c']);
  });

  it('keeps the property name verbatim rather than dashing it', () => {
    const { scope } = setup(ROOT, {
      id: '0',
      values: { 'prop$maxLength': { val: 5 } },
    });
    assert.strictEqual((scope.dom as any).maxLength, 5);
  });

  it('does nothing when server rendering, and does not report it', () => {
    // a property is state on an element instance: there is nothing for a
    // served page to carry, so skipping is the right outcome, not a failure
    const errors: RuntimeError[] = [];
    const source = parse(ROOT, 'test');
    const context = new WebContext({
      doc: source.doc,
      root: { id: '0', values: { 'prop$items': { val: ['a'] } } },
      server: true,
      onError: (e: RuntimeError) => errors.push(e),
    }).refresh();

    assert.isUndefined((context.root as WebScope).dom['items' as any]);
    assert.deepEqual(errors, []);
  });

  it('reports having no element to set the property on', () => {
    const errors: RuntimeError[] = [];
    setup(
      ROOT,
      { id: '0', values: {}, children: [{ id: 'gone', values: { 'prop$items': { val: [] } } }] },
      errors
    );
    assert.deepEqual(
      errors.map(e => e.message),
      ['unbound binding: no element to set property "items" on']
    );
  });
});

describe('flag$', () => {
  it('adds and removes an attribute rather than writing its value', () => {
    // an HTML boolean attribute means true by being present at all, so
    // writing "false" would read as true -- the whole reason this family
    // exists alongside `x=${...}`
    const { context, markup } = setup(ROOT, {
      id: '0',
      values: { 'flag$hidden': { val: false } },
    });
    assert.notInclude(markup(), 'hidden');

    context.root.proxy['flag$hidden'] = true;
    assert.include(markup(), 'hidden=""');

    context.root.proxy['flag$hidden'] = false;
    assert.notInclude(markup(), 'hidden');
  });

  it('keeps a dashed attribute name verbatim', () => {
    const { markup } = setup(ROOT, {
      id: '0',
      values: { 'flag$aria-busy': { val: true } },
    });
    assert.include(markup(), 'aria-busy=""');
  });

  it('reports having no element to toggle on', () => {
    const errors: RuntimeError[] = [];
    setup(
      ROOT,
      { id: '0', values: {}, children: [{ id: 'gone', values: { 'flag$open': { val: true } } }] },
      errors
    );
    assert.deepEqual(
      errors.map(e => e.message),
      ['unbound binding: no element to toggle "open" on']
    );
  });
});

describe('text$', () => {
  const MARKED =
    '<html data-markout="0"><body>' +
    '<!---t0-->&#8203;<!---/--> <!---t1-->&#8203;<!---/-->' +
    '</body></html>';

  it('binds by the id the marker carries, not by document order', () => {
    // the whole point of putting an id in the marker: a binding must not
    // depend on how many markers happen to precede it, or anything that
    // inserts or reorders markup in a scope's territory (slotted content,
    // above all) silently shifts every later binding onto the wrong node
    const { context, markup } = setup(
      '<html data-markout="0"><body>' +
        '<!---t1-->&#8203;<!---/--> <!---t0-->&#8203;<!---/-->' +
        '</body></html>',
      { id: '0', values: { text$0: { val: 'zero' }, text$1: { val: 'one' } } }
    );
    assert.include(markup(), '<!---t1-->one<!---/--> <!---t0-->zero<!---/-->');
    context.root.proxy.text$0 = 'changed';
    assert.include(markup(), '<!---t0-->changed<!---/-->');
  });

  it('reports a binding whose id is absent from the DOM', () => {
    // silence here is the worst outcome: the page renders, nothing throws,
    // and one binding is dead forever. Every way markup gets relocated --
    // slots, replication, stencil clones -- can produce exactly this
    const errors: RuntimeError[] = [];
    const { context, markup } = setup(
      '<html data-markout="0"><body><!---t0-->&#8203;<!---/--></body></html>',
      { id: '0', values: { text$0: { val: 'a' }, text$7: { val: 'b' } } },
      errors
    );
    context.root.proxy.text$7 = 'c';
    assert.include(markup(), '<!---t0-->a<!---/-->');
    assert.notInclude(markup(), 'c<');
    assert.deepEqual(
      errors.map(e => [e.scope, e.key, e.message]),
      [['0', 'text$7', 'unbound binding: no text node carrying that marker id']]
    );
  });

  it('reports an attribute binding with no element to write to', () => {
    const errors: RuntimeError[] = [];
    setup(
      '<html data-markout="0"><body></body></html>',
      { id: '0', values: {}, children: [{ id: 'missing', values: { 'attr$href': { val: '/x' } } }] },
      errors
    );
    assert.deepEqual(
      errors.map(e => e.message),
      ['unbound binding: no element to set "href" on']
    );
  });

  it('addresses marked text nodes by index', () => {
    const { context, markup } = setup(MARKED, {
      id: '0',
      values: { text$0: { val: 'a' }, text$1: { val: 'b' } },
    });
    assert.include(markup(), '<!---t0-->a<!---/--> <!---t1-->b<!---/-->');
    context.root.proxy.text$1 = 'c';
    assert.include(markup(), '<!---t1-->c<!---/-->');
  });

  it('reads through a marker sitting before an atomic-text container', () => {
    // <style>'s whole interpolated content is one text child, and a comment
    // can't survive inside a raw text element -- so stage1 puts the marker
    // immediately BEFORE the container and the binding reads through to it
    const { context, markup } = setup(
      '<html data-markout="0"><head data-markout="1">' +
        '<!---t0--><style>placeholder</style></head></html>',
      {
        id: '0',
        values: {},
        children: [{ id: '1', values: { text$0: { val: 'body{color:red}' } } }],
      }
    );
    assert.include(markup(), '<style>body{color:red}</style>');
    context.root.children[0].proxy.text$0 = 'body{color:blue}';
    assert.include(markup(), '<style>body{color:blue}</style>');
  });

  it('renders a nullish value as a zero-width space', () => {
    const { context, markup } = setup(MARKED, {
      id: '0',
      values: { text$0: { val: 'a' } },
    });
    context.root.proxy.text$0 = null;
    assert.include(markup(), '<!---t0-->​<!---/-->');
  });

  it('does nothing (rather than throwing) for an unrecognised key format', () => {
    const { context, markup } = setup(MARKED, {
      id: '0',
      values: { text$oops: { val: 'a' } },
    });
    context.root.proxy.text$oops = 'b';
    assert.include(markup(), '<!---t0-->​<!---/-->');
  });
});

describe('event$', () => {
  it('registers a listener when the value is a function', () => {
    const { scope } = setup(ROOT, {
      id: '0',
      values: { event$click: { exp: () => () => {} } },
    });
    assert.deepEqual(
      scope.domListeners?.map(l => l.name),
      ['click']
    );
  });

  it('dispatches the event to the value', () => {
    const seen: unknown[] = [];
    const { scope } = setup(ROOT, {
      id: '0',
      values: { event$click: { exp: () => (e: unknown) => seen.push(e) } },
    });
    const event = { type: 'click' };
    scope.domListeners![0].listener(event as unknown as Event);
    assert.deepEqual(seen, [event]);
  });

  it('ignores values that are not functions', () => {
    const { scope } = setup(ROOT, {
      id: '0',
      values: { event$click: { val: 'not a function' } },
    });
    assert.isUndefined(scope.domListeners);
  });

  it('removes its listeners on dispose', () => {
    const { scope } = setup(ROOT, {
      id: '0',
      values: { event$click: { exp: () => () => {} } },
    });
    scope.dispose();
    assert.deepEqual(scope.domListeners, []);
  });

  it('supports dashed multi-word event names verbatim', () => {
    const { scope } = setup(ROOT, {
      id: '0',
      values: { 'event$item-selected': { exp: () => () => {} } },
    });
    assert.deepEqual(
      scope.domListeners?.map(l => l.name),
      ['item-selected']
    );
  });
});

describe('scopes without a matching element', () => {
  it('keeps working, leaving the DOM untouched', () => {
    const { context, markup } = setup(ROOT, {
      id: '0',
      values: {},
      // no element carries data-markout="1"
      children: [
        {
          id: '1',
          name: 'orphan',
          values: {
            attr$lang: { val: 'en' },
            class$x: { val: true },
            style$color: { val: 'red' },
          },
        },
      ],
    });
    const orphan = context.root.children[0] as WebScope;
    assert.isUndefined(orphan.dom);
    assert.equal(markup(), '<html><head></head><body></body></html>');
    // values are still readable and writable
    orphan.proxy.attr$lang = 'it';
    assert.equal(orphan.proxy.attr$lang, 'it');
    assert.equal(markup(), '<html><head></head><body></body></html>');
  });
});
