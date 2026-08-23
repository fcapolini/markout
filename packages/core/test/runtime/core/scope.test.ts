import { assert, describe, expect, it, vi } from 'vitest';
import { CoreContext, PROPS_GLOBAL } from '../../../src/runtime/core/core-context';
import { CoreScope } from '../../../src/runtime/core/core-scope';

describe('constants', () => {
  it('names the window property the server and client agree on', () => {
    // the server middleware serializes page props into it, the client
    // bundle reads them back out: changing it breaks hydration
    assert.equal(PROPS_GLOBAL, '__MARKOUT_PROPS');
  });
});

function context(props: ConstructorParameters<typeof CoreContext>[0]) {
  return new CoreContext(props).refresh();
}

describe('proxy', () => {
  it('reads through to enclosing scopes', () => {
    const ctx = context({
      root: {
        id: '0',
        values: { outer: { val: 'v' } },
        children: [{ id: '1', name: 'inner', values: {} }],
      },
    });
    const inner = ctx.root.children[0];
    assert.equal(inner.proxy.outer, 'v');
  });

  it('exposes the parent scope as $parent', () => {
    const ctx = context({
      root: {
        id: '0',
        values: { v: { val: 1 } },
        children: [{ id: '1', name: 'inner', values: { w: { val: 2 } } }],
      },
    });
    const inner = ctx.root.children[0];
    assert.equal(inner.proxy.$parent.v, 1);
  });

  it('refuses to set an unknown key', () => {
    const ctx = context({ root: { id: '0', values: { v: { val: 1 } } } });
    assert.isFalse(Reflect.set(ctx.root.proxy, 'nonexistent', 1));
    assert.isUndefined(ctx.root.proxy.nonexistent);
  });
});

describe('dispose', () => {
  it('is a no-op for a scope without a parent', () => {
    // the root scope's parent is the global scope, which has none
    const ctx = context({ root: { id: '0', values: { v: { val: 1 } } } });
    ctx.global.dispose();
    assert.equal(ctx.root.proxy.v, 1);
  });

  it('detaches the root scope from the global one', () => {
    const ctx = context({ root: { id: '0', values: { v: { val: 1 } } } });
    assert.equal(ctx.global.children.length, 1);
    ctx.root.dispose();
    assert.equal(ctx.global.children.length, 0);
  });

  it('detaches an unnamed scope from its parent', () => {
    const ctx = context({
      root: { id: '0', values: {}, children: [{ id: '1', values: {} }] },
    });
    assert.equal(ctx.root.children.length, 1);
    ctx.root.children[0].dispose();
    assert.equal(ctx.root.children.length, 0);
  });

  it('also removes the value a named scope published to its parent', () => {
    const ctx = context({
      root: {
        id: '0',
        values: {},
        children: [{ id: '1', name: 'inner', values: { v: { val: 1 } } }],
      },
    });
    const inner = ctx.root.children[0] as CoreScope;
    assert.equal(ctx.root.proxy.inner.v, 1);
    inner.dispose();
    assert.isUndefined(ctx.root.values['inner']);
    assert.equal(ctx.root.children.length, 0);
  });

  it('tolerates being called twice', () => {
    const ctx = context({
      root: {
        id: '0',
        values: {},
        children: [{ id: '1', name: 'inner', values: {} }],
      },
    });
    const inner = ctx.root.children[0] as CoreScope;
    inner.dispose();
    inner.dispose();
    assert.equal(ctx.root.children.length, 0);
  });
});

describe('dependencies', () => {
  it('links dependents and unlinks them again', () => {
    const ctx = context({
      root: {
        id: '0',
        values: {
          a: { val: 1 },
          b: {
            exp: ($: any) => $.a + 1,
            deps: [
              ['a'],
            ],
          },
        },
      },
    });
    assert.equal(ctx.root.proxy.b, 2);
    const a = ctx.root.values['a'];
    const b = ctx.root.values['b'];
    assert.isTrue(a.dst.has(b));
    assert.isTrue(b.src.has(a));

    ctx.root.unlinkValues();
    assert.equal(a.dst.size, 0);
    assert.equal(b.src.size, 0);
  });

  it('detaches from old dependencies when overwritten with set()', () => {
    const ctx = context({
      root: {
        id: '0',
        values: {
          a: { val: 1 },
          b: {
            exp: ($: any) => $.a + 1,
            deps: [
              ['a'],
            ],
          },
        },
      },
    });
    const a = ctx.root.values['a'];
    const b = ctx.root.values['b'];
    assert.isTrue(a.dst.has(b));

    b.set(100);
    assert.isFalse(a.dst.has(b));
    assert.equal(b.src.size, 0);
  });

  it('ignores a dependency that cannot be resolved', () => {
    const ctx = context({
      root: {
        id: '0',
        values: {
          v: {
            val: 1,
            deps: [['nonexistent']],
          },
        },
      },
    });
    assert.equal(ctx.root.proxy.v, 1);
    assert.equal(ctx.root.values['v'].src.size, 0);
  });

  it('reports a throwing expression without aborting the refresh', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = context({
      root: {
        id: '0',
        values: {
          bad: {
            exp: () => {
              throw new Error('boom');
            },
          },
          good: { val: 'fine' },
        },
      },
    });
    expect(error).toHaveBeenCalled();
    assert.equal(ctx.root.proxy.good, 'fine');
    assert.isUndefined(ctx.root.proxy.bad);
    error.mockRestore();
  });
});

describe('lookup caching', () => {
  it('caches an inherited value on the requesting scope, not the owning one', () => {
    const ctx = context({
      root: {
        id: '0',
        values: { v: { val: 1 } },
        children: [{ id: '1', name: 'inner', values: {} }],
      },
    });
    const inner = ctx.root.children[0];
    assert.isFalse(inner.cache.has('v'));
    assert.equal(inner.proxy.v, 1);
    assert.isTrue(inner.cache.has('v'));
  });
});

describe('non-recursive value operations', () => {
  it('does not touch child scopes when recur is false', () => {
    const ctx = context({
      root: {
        id: '0',
        values: { a: { val: 1 } },
        children: [{ id: '1', name: 'child', values: { b: { val: 2 } } }],
      },
    });
    const root = ctx.root;
    const b = root.children[0].values['b'];
    const linkSpy = vi.spyOn(b, 'link');
    const unlinkSpy = vi.spyOn(b, 'unlink');
    const getSpy = vi.spyOn(b, 'get');

    root.unlinkValues(false);
    root.linkValues(false);
    root.updateValues(false);
    expect(unlinkSpy).not.toHaveBeenCalled();
    expect(linkSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();

    root.unlinkValues(true);
    root.linkValues(true);
    root.updateValues(true);
    expect(unlinkSpy).toHaveBeenCalledTimes(1);
    expect(linkSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});

describe('chained propagation', () => {
  it('propagates a change through multiple dependency levels exactly once each', () => {
    const ctx = context({
      root: {
        id: '0',
        values: {
          a: { val: 1 },
          b: {
            exp: ($: any) => $.a + 1,
            deps: [
              ['a'],
            ],
          },
          c: {
            exp: ($: any) => $.b + 1,
            deps: [
              ['b'],
            ],
          },
        },
      },
    });
    assert.equal(ctx.root.proxy.c, 3);

    const bCb = vi.fn();
    const cCb = vi.fn();
    ctx.root.values['b'].cb = bCb;
    ctx.root.values['c'].cb = cCb;

    ctx.root.proxy.a = 10;

    assert.equal(ctx.root.proxy.b, 11);
    assert.equal(ctx.root.proxy.c, 12);
    expect(bCb).toHaveBeenCalledTimes(1);
    expect(bCb).toHaveBeenCalledWith(ctx.root, 11);
    expect(cCb).toHaveBeenCalledTimes(1);
    expect(cCb).toHaveBeenCalledWith(ctx.root, 12);
  });
});

describe('dependency-free expressions', () => {
  it('computes once and does not re-evaluate on later refreshes', () => {
    let calls = 0;
    const ctx = context({
      root: {
        id: '0',
        values: {
          v: {
            exp: function () {
              calls++;
              return calls;
            },
          },
        },
      },
    });
    assert.equal(ctx.root.proxy.v, 1);
    assert.equal(calls, 1);

    ctx.refresh();
    // no deps means nothing could have changed it, so it stays stale
    assert.equal(ctx.root.proxy.v, 1);
    assert.equal(calls, 1);
  });
});
