import { assert, it } from 'vitest';
import { BaseContext } from '../../src/runtime/base/base-context';

it(`creates global scope`, () => {
  const context = new BaseContext({ root: { id: '0' } });
  assert.exists(context.global);
  assert.equal(context.global.props.name, 'window');
  assert.equal(context.global.proxy.console, console);
});

it(`adds custom global value`, () => {
  const context = new BaseContext({ root: { id: '0' } }, { custom: { val: 42 } });
  assert.equal(context.global.proxy.custom, 42);
});

it(`adds custom global function`, () => {
  const context = new BaseContext(
    { root: { id: '0' } },
    { custom: { val: (x: number) => x * 2 } }
  );
  assert.equal(context.global.proxy.custom(3), 6);
});

it(`adds a static value`, () => {
  const context = new BaseContext({
    root: { id: '0', values: { v1: { val: 42 } } },
  });
  assert.equal(context.root.proxy.v1, 42);
});

it(`adds a dynamic value`, () => {
  const context = new BaseContext({
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
  });
  assert.equal(context.root.proxy.v1, 42);
  context.root.proxy.v1 = 43;
  assert.equal(context.root.proxy.v1, 43);
});

it(`adds dependency (1)`, () => {
  const context = new BaseContext({
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
  });
  assert.equal(context.root.proxy.v1, 42);
  context.root.proxy.v0 = 43;
  assert.equal(context.root.proxy.v1, 43);
});

it(`adds dependency (2)`, () => {
  const context = new BaseContext({
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
  });
  assert.equal(context.root.proxy.v1, 42);
  context.root.proxy.v0 = 43;
  assert.equal(context.root.proxy.v1, 43);
});

it(`registers and de-registers scope name`, () => {
  const context = new BaseContext({
    root: {
      id: '0',
      children: [
        {
          id: '1',
          name: 'head',
          values: {
            v1: { val: 42 },
          },
        }
      ]
    },
  });
  assert.equal(context.root.children.length, 1);
  assert.exists(context.root.proxy.head);
  context.root.children[0].dispose();
  assert.equal(context.root.children.length, 0);
  assert.notExists(context.root.proxy.head);
});

it(`can see outer value`, () => {
  const context = new BaseContext({
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
  });
  assert.equal(context.root.proxy.head.v1, 42);
  context.root.proxy.v0 = 43;
  assert.equal(context.root.proxy.head.v1, 43);
});

it(`should call value callback (1)`, () => {
  let val = 0;
  const context = new BaseContext({
    root: { id: '0', values: { v1: { val: 42 } } },
  });
  context.root.values['v1'].cb = ((s, v) => {
    val = v;
  });
  context.root.proxy.v1++;
  assert.equal(val, 43);
  context.root.proxy.v1++;
  assert.equal(val, 44);
});

it(`should call value callback (2)`, () => {
  let val = 0;
  const context = new BaseContext({
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
  });
  context.root.values['v1'].cb = ((s, v) => {
    val = v;
  });
  context.root.proxy.v0++;
  assert.equal(val, 43);
  context.root.proxy.v0++;
  assert.equal(val, 44);
});

it(`should call value callback (2)`, () => {
  let val = 0;
  const context = new BaseContext({
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
  });
  context.root.children[0].values['v1'].cb = ((s, v) => {
    val = v;
  });
  context.root.proxy.v0++;
  assert.equal(val, 43);
  context.root.proxy.v0++;
  assert.equal(val, 44);
});

// it(`should replicate scope`, () => {
//   const context = new BaseContext({
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
