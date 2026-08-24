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
  const { root, exps } = loadProps(page.props!);
  const errors: string[] = [];
  const ctx = new WebContext({ root, exps, doc: page.source.doc });
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
  '<:define tag="mk-probe:span" ::count=${0}>${count}<:slot /></:define>';

function page(inner: string) {
  return `<html><body>${DEFS}${inner}</body></html>`;
}

describe('values declared inside slotted content', () => {
  it('feeds a custom-tag usage nested under the element that declares it', () => {
    const { page: p, ctx, errors } = run(
      page(
        '<main :aka="app" :x=${3}>' +
          '<mk-box><div :total=${x * 2}><mk-probe ::count=${total}></mk-probe></div></mk-box>' +
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
          '<div :total=${x * 2}><mk-probe ::count=${total}></mk-probe></div>' +
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
          '<mk-probe ::count=${total}>/${total}</mk-probe>' +
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
      page('<main :aka="app" :x=${3}><mk-box><mk-probe ::count=${x}></mk-probe></mk-box></main>')
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
        '<:define tag="mk-probe:span" ::count=${0}>${count}</:define>' +
        '<main><mk-box><mk-probe :aka="inner" ::count=${7} /></mk-box>' +
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

  it('fills a slot nested inside another of the definition\'s scopes', () => {
    // the scope CONTAINING the slot survives the fill -- the `<i>` is still
    // there -- but its text values point at a fallback this usage no longer
    // has. They used to be shared with every other usage of the definition,
    // so one instance came up reporting "no text node carrying that marker
    // id" while its sibling rendered fine
    const { page: p, errors } = run(
      '<html><body>' +
        '<:define tag="mk-panel:div" ::caption=${"fallback"}>' +
        '<i :aka="head"><:slot name="cap">${caption}</:slot></i><:slot />' +
        '</:define>' +
        '<main><mk-panel><b :slot="cap">filled</b>one</mk-panel>' +
        '<mk-panel>two</mk-panel></main>' +
        '</body></html>'
    );
    assert.deepEqual(errors, []);
    const markup = p.source.doc.toString();
    const body = markup.slice(markup.indexOf('<body'), markup.indexOf('<script'));
    // the filled one took the usage's markup; the other kept its fallback
    assert.include(body, '<b>filled</b>');
    assert.include(body, 'fallback');
  });

  it('binds text slotted into one of the definition\'s own scopes', () => {
    // where the node lands and where the expression resolves pull apart: a
    // binding belongs to the scope whose territory holds its node, which
    // here is the definition's inner <i>, while `${x}` was written outside
    // and has to go on meaning the caller's. It used to be claimed by
    // neither and render blank -- silently, which is how it survived
    const { page: p, ctx, errors } = run(
      '<html><body>' +
        '<:define tag="mk-panel:div" ::pad=${1}>' +
        '<i :aka="inner" :class-p=${pad}><:slot /></i>' +
        '</:define>' +
        '<main :aka="app" :x=${3}><mk-panel>[${x}]</mk-panel></main>' +
        '</body></html>'
    );
    assert.deepEqual(errors, []);
    const inner = findInBody(p.source.doc, 'I');
    assert.equal(textOf(inner), '[3]');

    // and it is the CALLER's value, so it keeps up with it
    findScope(ctx.root, 'app').proxy.x = 9;
    assert.equal(textOf(inner), '[9]');
  });

  it('finds its markup when the slot sits under a scope of its own', () => {
    // the runtime looks for a scope's element inside its PARENT's element,
    // and stops at any nested scope's rather than descending into it. So a
    // slotted scope has to sit under whichever scope owns the markup around
    // it -- and it went under the instance regardless, which is only the
    // same thing while the `<:slot>` is in the definition's own outermost
    // element. One `:class-` on the element between them was enough:
    // everything slotted in reported itself unbound, and a `:for-each` in
    // there rendered nothing at all, which reports nothing at all
    const { ctx, errors } = run(
      '<html><body :rows=${["a", "b"]}>' +
        '<:define tag="mk-panel:div" class="panel" ::flush=${false}>' +
        '<div class="body" :class-p-0=${flush}><:slot /></div>' +
        '</:define>' +
        '<mk-panel><i :for-each=${rows} :for-as="row">[${row}]</i></mk-panel>' +
        '</body></html>'
    );
    assert.deepEqual(errors, []);
    const body = findByTag((ctx.props as any).doc, 'BODY');
    const rendered: string[] = [];
    const walk = (n: any) => {
      n.tagName === 'I' && rendered.push(textOf(n));
      (n.childNodes ?? []).forEach(walk);
    };
    walk(body);
    // the stencil is out of the way in <head> and is no part of the body a
    // browser renders, so only the two replicas count
    assert.deepEqual(rendered, ['[a]', '[b]']);
  });

  it('keeps the enclosing definition invisible to markup slotted into it', () => {
    // the isolation half of the same rule: resolution now continues through
    // the slotted <div>, and must go on skipping the instance it sits in
    // rather than reading the definition's own names
    const p = compile(
      '<html><body>' +
        '<:define tag="mk-vault:div" ::secret=${"leaked"}><:slot /></:define>' +
        '<:define tag="mk-probe:span" ::count=${0}>${count}</:define>' +
        '<main><mk-vault><div :total=${1}><mk-probe ::count=${secret}></mk-probe></div></mk-vault></main>' +
        '</body></html>'
    );
    assert.deepEqual(
      p.errors.map((e: any) => e.msg),
      ['Unknown reference: "secret"']
    );
  });
});
