import { assert, describe, it } from 'vitest';
import { Page } from '../../../src/compiler/ir/Page';
import { stage1load } from '../../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../../src/compiler/stages/stage7-generate';
import { NodeType } from '../../../src/html/dom';
import { parse } from '../../../src/html/parser';
import { CoreScope, CoreScopeProps } from '../../../src/runtime/core/core-scope';
import { WebContext } from '../../../src/runtime/web/web-context';
import { loadProps } from '../../../src/render/props';

/**
 * Compiles real page source and runs the generated props through the actual
 * runtime, so these assert what a user would see rather than what the
 * compiler recorded. That distinction is the whole point here: a dependency
 * the compiler gets wrong doesn't throw, it produces a binding that quietly
 * never updates -- which only a before/after DOM comparison can catch.
 */
function run(html: string) {
  const page = new Page(parse(html, 'test.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  assert.deepEqual(
    page.errors.map((e: any) => e.msg),
    [],
    'expected the page to compile cleanly'
  );
  stage7generate(page);
  const { root, exps } = loadProps(page.propsString);
  const ctx = new WebContext({ root, exps, doc: page.source.doc }).refresh();
  return { page, ctx };
}

function findByTag(root: any, tagName: string): any {
  for (const n of root.childNodes ?? []) {
    if (n.tagName === tagName) return n;
    const found = findByTag(n, tagName);
    if (found) return found;
  }
  return undefined;
}

/** an element's own text, skipping the compiler's text-position markers */
function textOf(el: any): string {
  return (el.childNodes ?? [])
    .filter((n: any) => n.nodeType === NodeType.TEXT)
    .map((n: any) => n.textContent)
    .join('')
    .trim();
}

function findScope(scope: CoreScope, name: string): CoreScope {
  if (scope.props.name === name) return scope;
  for (const child of scope.children) {
    const found: CoreScope | undefined = tryFind(child, name);
    if (found) return found;
  }
  throw new Error(`no scope named "${name}"`);
}

function tryFind(scope: CoreScope, name: string): CoreScope | undefined {
  if (scope.props.name === name) return scope;
  for (const child of scope.children) {
    const found = tryFind(child, name);
    if (found) return found;
  }
  return undefined;
}

describe('reactivity through chained scope references', () => {
  it('updates a binding that reaches through two named scopes', () => {
    const { page, ctx } = run(
      '<html><body>' +
        '<div :aka="outer"><span :aka="inner" :count=${1}></span></div>' +
        '<p>ticks ${outer.inner.count}</p>' +
        '</body></html>'
    );
    const p = findByTag(page.source.doc, 'P');
    assert.equal(textOf(p), 'ticks 1');

    findScope(ctx.root, 'inner').proxy.count = 5;

    // the dependency used to be recorded as `outer.inner` -- a scope object
    // that never changes -- so this stayed at "ticks 1" forever
    assert.equal(textOf(p), 'ticks 5');
  });

  it('updates a binding that reaches through repeated $parent hops', () => {
    const { page, ctx } = run(
      '<html :n=${1}><body><div :aka="a"><p>n is ${$parent.$parent.n}</p></div></body></html>'
    );
    const p = findByTag(page.source.doc, 'P');
    assert.equal(textOf(p), 'n is 1');

    ctx.root.proxy.n = 7;

    // likewise: the dependency used to land on `$parent.$parent`, the parent
    // pointer itself, which is fixed for the life of the scope
    assert.equal(textOf(p), 'n is 7');
  });

  it('updates a binding whose dependency is a computed index', () => {
    const { page, ctx } = run(
      '<html :items=${["a", "b", "c"]} :i=${0}><body><p>${items[i]}</p></body></html>'
    );
    const p = findByTag(page.source.doc, 'P');
    assert.equal(textOf(p), 'a');

    ctx.root.proxy.i = 2;

    // `i` used to be left unqualified, making it an undeclared global at
    // runtime (a swallowed ReferenceError) and no dependency at all
    assert.equal(textOf(p), 'c');
  });

  it('updates when the intermediate scope value itself changes', () => {
    const { page, ctx } = run(
      '<html><body>' +
        '<div :aka="outer" :label=${"x"}><span :aka="inner" :count=${1}></span></div>' +
        '<p>${outer.label}/${outer.inner.count}</p>' +
        '</body></html>'
    );
    const p = findByTag(page.source.doc, 'P');
    assert.equal(textOf(p), 'x/1');

    findScope(ctx.root, 'outer').proxy.label = 'y';
    findScope(ctx.root, 'inner').proxy.count = 9;

    assert.equal(textOf(p), 'y/9');
  });
});
