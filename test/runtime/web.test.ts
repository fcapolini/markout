import { assert, it } from 'vitest';
import { parse } from '../../src/html/parser';
import { WebContext } from '../../src/runtime/web/web-context';
import { WebScope } from '../../src/runtime/web/web-scope';

it('should link scope to element', () => {
  const source = parse('<html data-markout="0"></html>', 'test');
  const context = new WebContext({
    doc: source.doc,
    root: { id: '0', values: {} }
  });
  const root = context.root as WebScope;
  assert.equal(root.dom, source.doc.documentElement);
});
