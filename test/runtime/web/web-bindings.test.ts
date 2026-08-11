import { parse } from '../../../src/html/parser';
import { assert, describe, expect, it, vi } from 'vitest';
import { CoreScopeProps } from '../../../src/runtime/core/core-scope';
import { WebContext } from '../../../src/runtime/web/web-context';
import { WebScope } from '../../../src/runtime/web/web-scope';

/**
 * The value-key prefixes are the contract between the compiler, which emits
 * them, and the runtime, which gives them meaning. These state the rules per
 * prefix rather than pinning one example each.
 */
function setup(html: string, root: CoreScopeProps) {
  const source = parse(html, 'test');
  const context = new WebContext({ doc: source.doc, root }).refresh();
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

  it('converts camelCase keys to dashed class names', () => {
    const { markup } = setup(ROOT, {
      id: '0',
      values: { class$isActive: { val: true } },
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

  it('converts camelCase keys to dashed property names', () => {
    const { markup } = setup(ROOT, {
      id: '0',
      values: { style$backgroundColor: { val: 'blue' } },
    });
    assert.include(markup(), 'background-color: blue;');
  });
});

describe('text$', () => {
  const MARKED =
    '<html data-markout="0"><body>' +
    '<!---t0-->&#8203;<!---/--> <!---t1-->&#8203;<!---/-->' +
    '</body></html>';

  it('addresses marked text nodes by index', () => {
    const { context, markup } = setup(MARKED, {
      id: '0',
      values: { text$0: { val: 'a' }, text$1: { val: 'b' } },
    });
    assert.include(markup(), '<!---t0-->a<!---/--> <!---t1-->b<!---/-->');
    context.root.proxy.text$1 = 'c';
    assert.include(markup(), '<!---t1-->c<!---/-->');
  });

  it('addresses marked text nodes by scope-qualified index', () => {
    const { markup } = setup(MARKED, {
      id: '0',
      values: { text$0_1: { val: 'second' } },
    });
    assert.include(markup(), '<!---t1-->second<!---/-->');
  });

  it('falls back to the first text child when there are no markers', () => {
    const { markup } = setup(
      '<html data-markout="0"><body data-markout="1">plain</body></html>',
      {
        id: '0',
        values: {},
        children: [{ id: '1', values: { text$0: { val: 'replaced' } } }],
      }
    );
    assert.include(markup(), '<body>replaced</body>');
  });

  it('renders a nullish value as a zero-width space', () => {
    const { context, markup } = setup(MARKED, {
      id: '0',
      values: { text$0: { val: 'a' } },
    });
    context.root.proxy.text$0 = null;
    assert.include(markup(), '<!---t0-->​<!---/-->');
  });

  it('warns and does nothing for an unrecognised key format', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { context, markup } = setup(MARKED, {
      id: '0',
      values: { text$oops: { val: 'a' } },
    });
    expect(warn).toHaveBeenCalledOnce();
    // the binding is inert rather than throwing
    context.root.proxy.text$oops = 'b';
    assert.include(markup(), '<!---t0-->​<!---/-->');
    warn.mockRestore();
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
