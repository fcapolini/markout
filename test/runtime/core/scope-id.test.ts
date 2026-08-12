import { assert, it } from 'vitest';
import { CoreContext } from '../../../src/runtime/core/core-context';
import { RT_ID_VALUE_KEY } from '../../../src/runtime/core/core-scope';

it('exposes each scope own compiler-assigned id', () => {
  const context = new CoreContext({
    root: {
      id: 's1',
      values: {},
      children: [
        { id: 's2', values: {} },
        { id: 's3', values: {} },
      ],
    },
  }).refresh();

  assert.equal(context.root.proxy[RT_ID_VALUE_KEY], 's1');
  assert.deepEqual(
    context.root.children.map(s => s.proxy[RT_ID_VALUE_KEY]),
    ['s2', 's3']
  );
});

it('gives a scope its own id even when it declares no values', () => {
  // lookup() walks up the scope chain, so a scope missing its own $id would
  // quietly answer with its parent's rather than failing
  const context = new CoreContext({
    root: { id: 's1', values: {}, children: [{ id: 's2' }] },
  }).refresh();

  assert.equal(context.root.children[0].proxy[RT_ID_VALUE_KEY], 's2');
});

it('keeps $id stable across refreshes and unrelated changes', () => {
  const context = new CoreContext({
    root: { id: 's1', values: { n: { exp: () => 0, deps: [] } } },
  }).refresh();

  assert.equal(context.root.proxy[RT_ID_VALUE_KEY], 's1');
  context.refresh();
  context.root.proxy['n'] = 5;
  context.refresh();
  assert.equal(context.root.proxy[RT_ID_VALUE_KEY], 's1');
});
