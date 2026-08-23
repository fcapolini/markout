import { assert, it, vi } from 'vitest';
import { CoreContext } from '../../../src/runtime/core/core-context';
import { RT_FOR_EACH_VALUE, RT_FOR_AS_VALUE } from '../../../src/runtime/core/core-scope';

it(`creates global scope`, () => {
  const context = new CoreContext({
    root: { id: '0' },
    addedGlobals: { console: { val: console } },
  }).refresh();
  assert.exists(context.global);
  assert.equal(context.global.props.name, 'window');
  assert.equal(context.global.proxy.console, console);
});

it(`adds custom global value`, () => {
  const context = new CoreContext({
    root: { id: '0' },
    addedGlobals: { custom: { val: 42 } },
  }).refresh();
  assert.equal(context.global.proxy.custom, 42);
});

it(`adds custom global function`, () => {
  const context = new CoreContext({
    root: { id: '0' },
    addedGlobals: { custom: { val: (x: number) => x * 2 } },
  }).refresh();
  assert.equal(context.global.proxy.custom(3), 6);
});

it(`adds a static value`, () => {
  const context = new CoreContext({
    root: { id: '0', values: { v1: { val: 42 } } },
  }).refresh();
  assert.equal(context.root.proxy.v1, 42);
});

it(`adds a dynamic value`, () => {
  const context = new CoreContext({
    root: {
      id: '0',
      values: {
        v1: {
          exp: function () {
            return 42;
          },
        },
      },
    },
  }).refresh();
  assert.equal(context.root.proxy.v1, 42);
  context.root.proxy.v1 = 43;
  assert.equal(context.root.proxy.v1, 43);
});

it(`adds dependency (1)`, () => {
  const context = new CoreContext({
    root: {
      id: '0',
      values: {
        v0: { val: 42 },
        v1: {
          exp: function () {
            // @ts-ignore
            return this.v0;
          },
          deps: [
            ['v0'],
          ],
        },
      },
    },
  }).refresh();
  assert.equal(context.root.proxy.v1, 42);
  context.root.proxy.v0 = 43;
  assert.equal(context.root.proxy.v1, 43);
});

it(`adds dependency (2)`, () => {
  const context = new CoreContext({
    root: {
      id: '0',
      values: {
        v0: {
          exp: function () {
            return 42;
          },
        },
        v1: {
          exp: function () {
            // @ts-ignore
            return this.v0;
          },
          deps: [
            ['v0'],
          ],
        },
      },
    },
  }).refresh();
  assert.equal(context.root.proxy.v1, 42);
  context.root.proxy.v0 = 43;
  assert.equal(context.root.proxy.v1, 43);
});

it(`registers and de-registers scope name`, () => {
  const context = new CoreContext({
    root: {
      id: '0',
      children: [
        {
          id: '1',
          name: 'head',
          values: {
            v1: { val: 42 },
          },
        },
      ],
    },
  }).refresh();
  assert.equal(context.root.children.length, 1);
  assert.exists(context.root.proxy.head);
  context.root.children[0].dispose();
  assert.equal(context.root.children.length, 0);
  assert.notExists(context.root.proxy.head);
});

it(`can see outer value`, () => {
  const context = new CoreContext({
    root: {
      id: '0',
      values: {
        v0: { val: 42 },
      },
      children: [
        {
          id: '1',
          name: 'head',
          values: {
            v1: {
              exp: function () {
                // @ts-ignore
                return this.v0;
              },
              deps: [
                ['v0'],
              ],
            },
          },
        },
      ],
    },
  }).refresh();
  assert.equal(context.root.proxy.head.v1, 42);
  context.root.proxy.v0 = 43;
  assert.equal(context.root.proxy.head.v1, 43);
});

it(`should call value callback (1)`, () => {
  let val = 0;
  const context = new CoreContext({
    root: { id: '0', values: { v1: { val: 42 } } },
  }).refresh();
  context.root.values['v1'].cb = (_s, v) => {
    val = v;
  };
  context.root.proxy.v1++;
  assert.equal(val, 43);
  context.root.proxy.v1++;
  assert.equal(val, 44);
});

it(`should call value callback (2)`, () => {
  let val = 0;
  const context = new CoreContext({
    root: {
      id: '0',
      values: {
        v0: { val: 42 },
        v1: {
          exp: function () {
            // @ts-ignore
            return this.v0;
          },
          deps: [
            ['v0'],
          ],
        },
      },
    },
  }).refresh();
  context.root.values['v1'].cb = (_s, v) => {
    val = v;
  };
  context.root.proxy.v0++;
  assert.equal(val, 43);
  context.root.proxy.v0++;
  assert.equal(val, 44);
});

it(`should call value callback (2)`, () => {
  let val = 0;
  const context = new CoreContext({
    root: {
      id: '0',
      values: {
        v0: { val: 42 },
      },
      children: [
        {
          id: '1',
          name: 'head',
          values: {
            v1: {
              exp: function () {
                // @ts-ignore
                return this.v0;
              },
              deps: [
                ['v0'],
              ],
            },
          },
        },
      ],
    },
  }).refresh();
  context.root.children[0].values['v1'].cb = (_s, v) => {
    val = v;
  };
  context.root.proxy.v0++;
  assert.equal(val, 43);
  context.root.proxy.v0++;
  assert.equal(val, 44);
});

// it(`should replicate scope`, () => {
//   const context = new CoreContext({
//     root: {
//       id: '0',
//       children: [
//         {
//           id: '1',
//         },
//       ],
//     },
//   });
// });

it(`replicates a scope for each array item as clones -- the host itself never represents one`, () => {
  const context = new CoreContext({
    root: {
      id: '0',
      values: {
        [RT_FOR_EACH_VALUE]: { val: [10, 20, 30] },
        data: {},
      },
    },
  }).refresh();

  assert.equal(context.root.clones?.length, 3);
  assert.deepEqual(
    context.root.clones?.map(c => c.proxy.data),
    [10, 20, 30]
  );
});

it(`treats null/undefined as zero items, removing all clones`, () => {
  const context = new CoreContext({
    root: {
      id: '0',
      values: {
        [RT_FOR_EACH_VALUE]: { val: [1, 2, 3] },
        data: {},
      },
    },
  }).refresh();
  assert.equal(context.root.clones?.length, 3);

  context.root.proxy[RT_FOR_EACH_VALUE] = null;
  assert.equal(context.root.clones?.length, 0);
});

it(`grows and shrinks clones as the array changes, reusing existing ones in place`, () => {
  const context = new CoreContext({
    root: {
      id: '0',
      values: {
        [RT_FOR_EACH_VALUE]: { val: [1, 2, 3] },
        data: {},
      },
    },
  }).refresh();
  const firstClone = context.root.clones![0];

  context.root.proxy[RT_FOR_EACH_VALUE] = [1, 2, 3, 4, 5];
  assert.equal(context.root.clones?.length, 5);
  assert.equal(context.root.clones![0], firstClone, 'existing clone identity is reused, not recreated');

  context.root.proxy[RT_FOR_EACH_VALUE] = [1];
  assert.equal(context.root.clones?.length, 1);
  assert.equal(context.root.clones![0].proxy.data, 1);
});

it(`honors a custom :for-as-style alias name`, () => {
  const context = new CoreContext({
    root: {
      id: '0',
      values: {
        [RT_FOR_EACH_VALUE]: { val: ['a', 'b'] },
        [RT_FOR_AS_VALUE]: { val: 'item' },
        item: {},
      },
    },
  }).refresh();

  assert.deepEqual(
    context.root.clones?.map(c => c.proxy.item),
    ['a', 'b']
  );
});

it(`clones ignore their own for$each -- only the host reconciles`, () => {
  const context = new CoreContext({
    root: {
      id: '0',
      values: {
        [RT_FOR_EACH_VALUE]: { val: [1, 2] },
        data: {},
      },
    },
  }).refresh();

  const clone = context.root.clones![0];
  assert.equal(clone.cloned, true);
  assert.isUndefined(clone.clones);
});

it(`binds a global that insists on the global object as its receiver`, () => {
  // what a browser does: the timers are methods of the global object and
  // throw "Illegal invocation" for any other `this` -- and an expression
  // reaches one as `this.setTimeout(...)`, where `this` is the scope proxy
  const native = function (this: unknown) {
    if (this !== globalThis) {
      throw new TypeError('Illegal invocation');
    }
    return 42;
  };
  vi.stubGlobal('setTimeout', native);
  try {
    const context = new CoreContext({ root: { id: '0' } }).refresh();
    assert.equal(context.root.proxy.setTimeout(), 42);
  } finally {
    vi.unstubAllGlobals();
  }
});

it(`leaves a constructor's own statics reachable`, () => {
  // the other half of the same decision: binding these would drop `.from`,
  // and `Array.from({ length: n }, ...)` is how a page builds a range
  const context = new CoreContext({ root: { id: '0' } }).refresh();
  assert.equal(context.root.proxy.Array, Array);
  assert.deepEqual(
    context.root.proxy.Array.from({ length: 3 }, (_: unknown, i: number) => i + 1),
    [1, 2, 3]
  );
  assert.equal(context.root.proxy.Math, Math);
});

it(`settles both arms of a diamond before evaluating what reads them`, () => {
  // the shape a paged table has: `page` is derived from the page number and
  // from how many pages there are, and `shown` reads both `page` and the
  // rows it slices. A change to the page number reaches `shown` down the
  // short arm -- through `rows` re-evaluating to a fresh array -- while
  // `page` is still mid-evaluation on the long one, and `shown` used to
  // settle for the cycle against the page number it was about to stop having
  const dep = (name: string) => [name];
  const context = new CoreContext({
    root: {
      id: '0',
      values: {
        n: { val: 1 },
        items: { val: [1, 2, 3, 4, 5, 6] },
        // a fresh array every evaluation, so it always counts as changed --
        // which is what pushes the short arm ahead of the long one
        rows: { exp: function (this: any) { return [...this.items]; }, deps: [dep('items')] },
        pages: { exp: function (this: any) { return this.rows.length / 2; }, deps: [dep('rows')] },
        page: {
          exp: function (this: any) { return Math.min(this.n, this.pages); },
          deps: [dep('n'), dep('pages')],
        },
        shown: {
          exp: function (this: any) { return this.rows.slice((this.page - 1) * 2, this.page * 2); },
          deps: [dep('rows'), dep('page')],
        },
      },
    },
  }).refresh();

  assert.deepEqual(context.root.proxy.shown, [1, 2]);

  context.root.proxy.n = 2;
  assert.equal(context.root.proxy.page, 2);
  assert.deepEqual(context.root.proxy.shown, [3, 4]);

  context.root.proxy.n = 3;
  assert.equal(context.root.proxy.page, 3);
  assert.deepEqual(context.root.proxy.shown, [5, 6]);

  // and the clamp still holds, which is the other half of `page`
  context.root.proxy.n = 9;
  assert.equal(context.root.proxy.page, 3);
  assert.deepEqual(context.root.proxy.shown, [5, 6]);
});

it(`orders a propagation by how far a value is from what it depends on`, () => {
  const dep = (name: string) => [name];
  const context = new CoreContext({
    root: {
      id: '0',
      values: {
        a: { val: 1 },
        b: { exp: function (this: any) { return this.a + 1; }, deps: [dep('a')] },
        c: { exp: function (this: any) { return this.b + 1; }, deps: [dep('b')] },
      },
    },
  }).refresh();
  const value = (k: string) => (context.root as any).values[k];
  assert.equal(value('a').depthNow(), 0);
  assert.equal(value('b').depthNow(), 1);
  assert.equal(value('c').depthNow(), 2);
});
