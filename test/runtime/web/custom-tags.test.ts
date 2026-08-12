import { parse } from '../../../src/html/parser';
import { assert, describe, it } from 'vitest';
import { CoreScopeProps } from '../../../src/runtime/core/core-scope';
import { WebContext } from '../../../src/runtime/web/web-context';
import { WebScope } from '../../../src/runtime/web/web-scope';

// mirrors what stage1-load produces for a <:define>/custom-tag usage: the
// definition's stencil lives inside a <template> (never itself live), and
// the usage site is a comment marker until WebScope instantiates it
const HTML =
  '<html data-markout="0"><head>' +
  '<template><button class="action" data-markout="def"></button></template>' +
  '</head><body><!---uuse--></body></html>';

function setup(root: CoreScopeProps, html = HTML) {
  const source = parse(html, 'test');
  const context = new WebContext({ doc: source.doc, root }).refresh();
  return { source, context };
}

function findByTag(root: any, tagName: string): any {
  for (const n of root.childNodes ?? []) {
    if (n.tagName === tagName) return n;
    const found = findByTag(n, tagName);
    if (found) return found;
  }
  return undefined;
}

describe('custom tags: usage-site DOM instantiation', () => {
  it('replaces the marker with a clone of the definition stencil', () => {
    const { source, context } = setup({
      id: '0',
      values: {},
      children: [
        { id: 'use', template: 'def', values: { 'class$active': { val: true } } },
      ],
    });

    const body = findByTag(source.doc, 'BODY');
    const button = body.childNodes.find((n: any) => n.tagName === 'BUTTON');
    assert.isDefined(button);
    assert.equal(button.getAttribute('data-markout'), 'use');
    assert.include(button.className, 'action');
    assert.include(button.className, 'active');
    // the marker comment is gone, replaced in place
    const stillHasMarker = body.childNodes.some(
      (n: any) => n.nodeType === 8 && n.textContent === '-uuse'
    );
    assert.isFalse(stillHasMarker);

    const usageScope = context.root.children[0] as WebScope;
    assert.strictEqual(usageScope.dom, button);
  });

  it('leaves the definition scope inert (no DOM operations)', () => {
    const { context } = setup({
      id: '0',
      values: {},
      children: [
        { id: 'use', template: 'def', values: {} },
      ],
    });
    // no scope is ever constructed for id "def" -- the definition only
    // exists as a static stencil in the DOM, never as a live CoreScope
    assert.equal(context.root.children.length, 1);
  });

  it('reuses an already-instantiated element by id instead of cloning again (SSR hydration)', () => {
    const html =
      '<html data-markout="0"><head>' +
      '<template><button data-markout="def"></button></template>' +
      '</head><body><button data-markout="use" class="active"></button></body></html>';
    const source = parse(html, 'test');
    const body = findByTag(source.doc, 'BODY');
    const preexisting = body.childNodes.find((n: any) => n.tagName === 'BUTTON');

    const context = new WebContext({
      doc: source.doc,
      root: {
        id: '0',
        values: {},
        children: [{ id: 'use', template: 'def', values: {} }],
      },
    }).refresh();

    const usageScope = context.root.children[0] as WebScope;
    assert.strictEqual(usageScope.dom, preexisting);
    assert.equal(body.childNodes.filter((n: any) => n.tagName === 'BUTTON').length, 1);
  });
});
