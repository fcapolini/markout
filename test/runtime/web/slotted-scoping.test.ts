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

/**
 * Names declared on markup that a usage site slots INTO a custom tag, read
 * from further inside that same slotted markup.
 *
 * Same shape as scope-chains.test.ts, for the same reason: the failure this
 * pins is a lookup that lands in the wrong scope, and the only honest way to
 * see that is to compile real source, run it, change a value and check the
 * DOM moved. A compiler-side assertion would have passed throughout -- the
 * compiler had this right; it was the `slotted` flag it emitted for the
 * runtime that was wrong.
 */
function compile(html: string) {
  const page = new Page(parse(html, 'test.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  return page;
}

function run(html: string) {
  const page = compile(html);
  assert.deepEqual(
    page.errors.map((e: any) => e.msg),
    [],
    'expected the page to compile cleanly'
  );
  stage7generate(page);
  const root = new Function(`return (${page.propsString});`)() as CoreScopeProps;
  const errors: string[] = [];
  const ctx = new WebContext({ root, doc: page.source.doc });
  // a lookup that misses is reported, not thrown: CoreValue.link() calls it
  // "a markout bug, not a page bug", so a test that only looked at the DOM
  // would miss the diagnosis even when it caught the symptom
  const inherited = (ctx as any).onError.bind(ctx);
  (ctx as any).onError = (phase: string, err: unknown, ...rest: unknown[]) => {
    errors.push(`${phase}: ${err}`);
    return inherited(phase, err, ...rest);
  };
  ctx.refresh();
  return { page, ctx, errors };
}

/** the deepest element carrying this tag name, so a stencil in <head> (which
 * is never live) can't be mistaken for the instantiated one */
function findInBody(root: any, tagName: string): any {
  const body = findByTag(root, 'BODY');
  return findByTag(body, tagName);
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
    const found = tryFind(child, name);
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

// a tag that is nothing but a slot, and one that renders a value it is given
// alongside whatever it was handed
const DEFS =
  '<:define tag="mk-box:div"><:slot /></:define>' +
  '<:define tag="mk-probe:span" :count=${0}>${count}<:slot /></:define>';

function page(inner: string) {
  return `<html><body>${DEFS}${inner}</body></html>`;
}

describe('values declared inside slotted content', () => {
  it('feeds a custom-tag usage nested under the element that declares it', () => {
    const { page: p, ctx, errors } = run(
      page(
        '<main :aka="app" :x=${3}>' +
          '<mk-box><div :total=${x * 2}><mk-probe :count=${total}></mk-probe></div></mk-box>' +
          '</main>'
      )
    );
    const probe = findInBody(p.source.doc, 'SPAN');
    // the instance used to resolve `total` at the OUTER call site (skipping
    // the slotted <div> that declares it), which reported an unresolved
    // dependency and left this empty
    assert.deepEqual(errors, []);
    assert.equal(textOf(probe), '6');

    findScope(ctx.root, 'app').proxy.x = 10;
    assert.equal(textOf(probe), '20');
  });

  it('feeds a plain descendant scope of the element that declares it', () => {
    const { page: p, ctx } = run(
      page(
        '<main :aka="app" :x=${3}>' +
          '<mk-box><div :total=${x * 2}><p :y=${total + 1}>${y}</p></div></mk-box>' +
          '</main>'
      )
    );
    const el = findInBody(p.source.doc, 'P');
    assert.equal(textOf(el), '7');

    findScope(ctx.root, 'app').proxy.x = 10;
    assert.equal(textOf(el), '21');
  });

  it('survives two levels of slotting', () => {
    const { page: p, ctx, errors } = run(
      page(
        '<main :aka="app" :x=${3}>' +
          '<mk-box><mk-box>' +
          '<div :total=${x * 2}><mk-probe :count=${total}></mk-probe></div>' +
          '</mk-box></mk-box>' +
          '</main>'
      )
    );
    const probe = findInBody(p.source.doc, 'SPAN');
    assert.deepEqual(errors, []);
    assert.equal(textOf(probe), '6');

    findScope(ctx.root, 'app').proxy.x = 10;
    assert.equal(textOf(probe), '20');
  });

  it('feeds interpolated text handed to a usage nested under it', () => {
    // the same rule for the other kind of usage-site value: text written
    // between a custom tag's tags is rehomed onto the instance and marked
    // call-site-resolved (see rehomeSlottedText), so it took the same wrong
    // turn -- and rendered nothing at all rather than reporting anything
    const { page: p, ctx, errors } = run(
      page(
        '<main :aka="app" :x=${3}>' +
          '<mk-box><div :total=${x * 2}><mk-probe>t=${total}</mk-probe></div></mk-box>' +
          '</main>'
      )
    );
    const probe = findInBody(p.source.doc, 'SPAN');
    assert.deepEqual(errors, []);
    assert.equal(textOf(probe), '0t=6');

    findScope(ctx.root, 'app').proxy.x = 10;
    assert.equal(textOf(probe), '0t=20');
  });

  it('feeds an attribute and slotted text on the same nested usage', () => {
    // the shape the bug was originally reported in: both halves at once
    const { page: p, ctx, errors } = run(
      page(
        '<main :aka="app" :x=${3}>' +
          '<mk-box><div :total=${x * 2}>' +
          '<mk-probe :count=${total}>/${total}</mk-probe>' +
          '</div></mk-box>' +
          '</main>'
      )
    );
    const probe = findInBody(p.source.doc, 'SPAN');
    assert.deepEqual(errors, []);
    assert.equal(textOf(probe), '6/6');

    findScope(ctx.root, 'app').proxy.x = 10;
    assert.equal(textOf(probe), '20/20');
  });

  it('still resolves a usage sitting DIRECTLY in the slot at the call site', () => {
    // the case the nesting fix must not take away: with nothing in between,
    // the instance is written at the call site and reads its values there
    const { page: p, ctx, errors } = run(
      page('<main :aka="app" :x=${3}><mk-box><mk-probe :count=${x}></mk-probe></mk-box></main>')
    );
    const probe = findInBody(p.source.doc, 'SPAN');
    assert.deepEqual(errors, []);
    assert.equal(textOf(probe), '3');

    findScope(ctx.root, 'app').proxy.x = 9;
    assert.equal(textOf(probe), '9');
  });

  it('makes an :aka on slotted markup readable from the call site', () => {
    // the name is written where the tag is written, so it belongs out here
    // however deeply the instance re-homes the markup's DOM. It used to be
    // registered on the instance instead -- somewhere no lookup from the
    // call site ever walks, leaving the name reachable from nowhere at all
    const { page: p, ctx, errors } = run(
      '<html><body>' +
        '<:define tag="mk-box:div"><:slot /></:define>' +
        '<:define tag="mk-probe:span" :count=${0}>${count}</:define>' +
        '<main><mk-box><mk-probe :aka="inner" :count=${7} /></mk-box>' +
        '<i>${inner.count}</i></main>' +
        '</body></html>'
    );
    const echo = findInBody(p.source.doc, 'I');
    assert.deepEqual(errors, []);
    assert.equal(textOf(echo), '7');

    // and writable: one value, wherever it is read from
    findScope(ctx.root, 'inner').proxy.count = 9;
    assert.equal(textOf(echo), '9');
    assert.equal(textOf(findInBody(p.source.doc, 'SPAN')), '9');
  });

  it('keeps the enclosing definition invisible to markup slotted into it', () => {
    // the isolation half of the same rule: resolution now continues through
    // the slotted <div>, and must go on skipping the instance it sits in
    // rather than reading the definition's own names
    const p = compile(
      '<html><body>' +
        '<:define tag="mk-vault:div" :secret=${"leaked"}><:slot /></:define>' +
        '<:define tag="mk-probe:span" :count=${0}>${count}</:define>' +
        '<main><mk-vault><div :total=${1}><mk-probe :count=${secret}></mk-probe></div></mk-vault></main>' +
        '</body></html>'
    );
    assert.deepEqual(
      p.errors.map((e: any) => e.msg),
      ['Unknown reference: "secret"']
    );
  });
});
