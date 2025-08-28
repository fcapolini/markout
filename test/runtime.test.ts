import { assert, it } from 'vitest';
import { Context } from '../src/runtime/context';

it('creates global scope', () => {
  const context = new Context({ root: { id: '0' } });
  assert.exists(context.global);
  assert.equal(context.global.props.name, 'window');
  assert.equal(context.global.proxy.console, console);
});

it('adds custom global value', () => {
  const context = new Context({ root: { id: '0' } }, { custom: { val: 42 } });
  assert.equal(context.global.proxy.custom, 42);
});

it('adds custom global function', () => {
  const context = new Context(
    { root: { id: '0' } },
    { custom: { val: (x: number) => x * 2 } }
  );
  assert.equal(context.global.proxy.custom(3), 6);
});
