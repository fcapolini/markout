import { assert, it } from 'vitest';
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
            function () {
              // @ts-ignore
              return this.$value('v0');
            },
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
            function () {
              // @ts-ignore
              return this.$value('v0');
            },
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
                function () {
                  // @ts-ignore
                  return this.$value('v0');
                },
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
            function () {
              // @ts-ignore
              return this.$value('v0');
            },
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
                function () {
                  // @ts-ignore
                  return this.$value('v0');
                },
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

it(`replicates a scope for each array item, first item on the host itself`, () => {
  const context = new CoreContext({
    root: {
      id: '0',
      values: {
        [RT_FOR_EACH_VALUE]: { val: [10, 20, 30] },
        data: {},
      },
    },
  }).refresh();

  assert.equal(context.root.proxy.data, 10);
  assert.equal(context.root.clones?.length, 2);
  assert.deepEqual(
    context.root.clones?.map(c => c.proxy.data),
    [20, 30]
  );
});

it(`treats null/undefined as zero items, removing any existing clones`, () => {
  const context = new CoreContext({
    root: {
      id: '0',
      values: {
        [RT_FOR_EACH_VALUE]: { val: [1, 2, 3] },
        data: {},
      },
    },
  }).refresh();
  assert.equal(context.root.clones?.length, 2);

  context.root.proxy[RT_FOR_EACH_VALUE] = null;
  assert.equal(context.root.clones?.length, 0);
  // KNOWN GAP: the host's own per-item value is never reset (stays 1, the
  // last real item) when the array becomes null/undefined -- foreachCB's
  // "not an array" branch only removes clones, it never touches the
  // host's own alias value or hides the host's own DOM contribution. The
  // language rule ("null/undefined means zero elements, nothing rendered")
  // isn't actually honored for the host's own instance yet.
  assert.equal(context.root.proxy.data, 1);
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
  assert.equal(context.root.clones?.length, 4);
  assert.equal(context.root.clones![0], firstClone, 'existing clone identity is reused, not recreated');

  context.root.proxy[RT_FOR_EACH_VALUE] = [1];
  assert.equal(context.root.clones?.length, 0);
  assert.equal(context.root.proxy.data, 1);
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

  assert.equal(context.root.proxy.item, 'a');
  assert.deepEqual(
    context.root.clones?.map(c => c.proxy.item),
    ['b']
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
