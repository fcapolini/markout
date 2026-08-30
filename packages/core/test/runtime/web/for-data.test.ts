import { describe, expect, it } from 'vitest';
import { Page } from '../../../src/compiler/ir/Page';
import { stage1load } from '../../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../../src/compiler/stages/stage7-generate';
import { parse } from '../../../src/html/parser';
import type { RuntimeError } from '../../../src/runtime/core/core-context';
import { WebContext } from '../../../src/runtime/web/web-context';
import { loadProps } from '../../../src/render/props';

/**
 * `:for-data` — `:for-each`'s arity minus the copies.
 *
 * Two things separate it from replication, and both are load-bearing rather
 * than incidental. Nothing is cloned: the scope owns one element for its
 * whole life and that element is moved between the document and the stencil
 * it arrived in. And while there is nothing to show, the body does not
 * evaluate — which is the point of the directive, since `${data.name}` has
 * to be safe to write for a `data` that may not be there.
 */
function run(html: string) {
  const page = new Page(parse(html, 'for-data.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  const errors = page.errors.map(e => e.msg);
  // the same shape either way, so that a caller reading `head()` after a
  // compile error gets an empty string rather than a union it has to narrow
  if (errors.length) {
    return { errors, runtime: [], ctx: undefined, markup: () => '', head: () => '' };
  }
  stage7generate(page);
  const runtime: RuntimeError[] = [];
  const ctx = new WebContext({
    ...loadProps(page.props!),
    doc: page.source.doc,
    onError: (e: RuntimeError) => runtime.push(e),
  }).refresh();
  return {
    ctx,
    errors,
    runtime: runtime.map(e => `${e.phase}: ${e.message}`),
    /** what the reader sees: no stencil is in here, they are all in <head> */
    markup: () => {
      const s = page.source.doc.toString();
      return s
        .slice(s.indexOf('<body'), s.indexOf('<script'))
        .replace(/ data-markout="[^"]*"/g, '');
    },
    /** where a region's markup waits while it has nothing to show */
    head: () => {
      const s = page.source.doc.toString();
      return s.slice(0, s.indexOf('<body')).replace(/ data-markout="[^"]*"/g, '');
    },
  };
}

describe(':for-data', () => {
  it('renders once for a value that is there', () => {
    const { errors, runtime, markup } = run(
      '<html><body :user=${{ name: "Ada" }}><p :for-data=${user}>Hi ${data.name}</p></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(markup()).toContain('<p>Hi <!---t0-->Ada<!---/--></p>');
  });

  it('renders nothing, and evaluates nothing, for a value that is not', () => {
    // `data.boom.deep` would throw for anyone who ran it. Nobody does, and
    // that is the whole feature: a guard that still evaluates its body is
    // not a guard
    const { errors, runtime, markup, head } = run(
      '<html><body :user=${null}><p :for-data=${user}>${data.boom.deep}</p></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    // nothing where it was written but the marker holding the place
    expect(markup()).not.toContain('<p');
    expect(markup()).toContain('<!---c');
    // and the markup itself waiting in its stencil, which is how it travels
    // to the browser at all and how it comes back if the value does
    expect(head()).toContain('<p>');
  });

  it('treats 0 and the empty string as data', () => {
    // `!= null`, the same rule `:for-each` states for an empty list. A page
    // that means "if this is true" wants a directive that says so
    const { markup } = run(
      '<html><body :n=${0} :s=${""}><p :for-data=${n}>[${data}]</p>' +
        '<i :for-data=${s}>[${data}]</i></body></html>'
    );
    expect(markup()).toContain('<p>[<!---t0-->0<!---/-->]</p>');
    expect(markup()).toContain('<i>');
  });

  it('binds the item under :for-as like :for-each does', () => {
    const { errors, markup } = run(
      '<html><body :user=${{ name: "Ada" }}>' +
        '<p :for-data=${user} :for-as="u">${u.name}</p></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(markup()).toContain('Ada');
  });

  it('shows and hides as the value comes and goes', () => {
    const { ctx, markup } = run(
      '<html><body :user=${{ name: "Ada" }}><p :for-data=${user}>${data.name}</p></body></html>'
    );
    const body = ctx!.root.proxy.body;
    expect(markup()).toContain('<p>');

    body.user = null;
    expect(markup()).not.toContain('<p');

    body.user = { name: 'Grace' };
    // back in place, with the new item -- and the region has to still be
    // WATCHING while hidden for this to happen at all
    expect(markup()).toContain('<p><!---t0-->Grace<!---/--></p>');
  });

  it('keeps the same element across a round trip', () => {
    // moved, not rebuilt: whatever the DOM was holding -- focus, a scroll
    // offset, a playing video -- is still holding it afterwards
    const { ctx, markup } = run(
      '<html><body :user=${{ name: "Ada" }}><p :for-data=${user}>${data.name}</p></body></html>'
    );
    const scope: any = (ctx!.root.children[1] as any).children[0];
    const before = scope.dom;
    ctx!.root.proxy.body.user = null;
    ctx!.root.proxy.body.user = { name: 'Grace' };
    expect(scope.dom).toBe(before);
    expect(markup()).toContain('Grace');
  });

  it('renders in the place it was written', () => {
    const { markup } = run(
      '<html><body :user=${{ name: "Ada" }}><i>before</i>' +
        '<p :for-data=${user}>mid</p><b>after</b></body></html>'
    );
    const body = markup();
    expect(body.indexOf('<i>')).toBeLessThan(body.indexOf('<p>'));
    expect(body.indexOf('<p>')).toBeLessThan(body.indexOf('<b>'));
  });

  it('works on a custom tag, and its slotted content sees the item', () => {
    const { errors, runtime, markup } = run(
      '<html><head><:define tag="my-box:div"><:slot /></:define></head>' +
        '<body :user=${{ name: "Ada" }}>' +
        '<my-box :for-data=${user}>[${data.name}]</my-box></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(markup().replace(/<!--.*?-->/g, '')).toContain('[Ada]');
  });

  it('lets a usage fill a slot inside the region', () => {
    // the reason `:for-data` is not built on replication. A `:for-each`
    // stencil is stamped out per item and there is one set of scopes to go
    // round, so a slot in there cannot be filled; this one holds the single
    // copy it will ever have, and the scopes behind the slot have nobody to
    // fight with
    const { errors, runtime, markup } = run(
      '<html><head><:define tag="my-card:div" ::header=${null}>' +
        '<i :for-data=${header}><:slot name="head" /></i>' +
        '<:slot /></:define></head>' +
        '<body><my-card ::header="H"><b :slot="head">Rich</b>body</my-card></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(markup()).toContain('<i><b>Rich</b></i>');
  });

  it('still keeps the region out when the value is absent, slot or no slot', () => {
    const { errors, runtime, markup } = run(
      '<html><head><:define tag="my-card:div" ::header=${null}>' +
        '<i :for-data=${header}><:slot name="head" /></i>' +
        '<:slot /></:define></head>' +
        '<body><my-card>body</my-card></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(markup()).not.toContain('<i');
  });

  it('refuses :for-key, which has nothing to tell apart', () => {
    const { errors } = run(
      '<html><body :user=${1}><p :for-data=${user} :for-key=${data}>x</p></body></html>'
    );
    expect(errors).toStrictEqual([
      '":for-key" means nothing on ":for-data": there is only ever one',
    ]);
  });

  it('refuses being asked how many times twice', () => {
    const { errors } = run(
      '<html><body :user=${1}><p :for-each=${[1]} :for-data=${user}>x</p></body></html>'
    );
    expect(errors).toStrictEqual([
      'Cannot use ":for-each" and ":for-data" on the same element',
    ]);
  });
});

/**
 * A region's own child scopes.
 *
 * These are built lazily, because a `:for-data` is a stencil until it has
 * something to show and a stencil deliberately does not build its subtree --
 * evaluating against an item that is never there is the failure the
 * directive exists to prevent. What was missing is the other half: growing
 * that subtree once the region stops being a stencil.
 *
 * `:for-each` inside one always worked, which is why this survived so long:
 * replicas are cloned from props on demand and never needed the prototype.
 * An ordinary child scope simply did not exist, so its bindings had nowhere
 * to write and the region rendered empty -- silently, since nothing failed.
 */
describe(':for-data: child scopes', () => {
  it('builds them when the region is showing from the first evaluation', () => {
    const r = run('<html><body><div :for-data=${true}><i :n=${41 + 1}>${n}</i></div></body></html>');
    expect(r.errors).toStrictEqual([]);
    expect(r.runtime).toStrictEqual([]);
    expect(r.markup()).toContain('<i><!---t0-->42<!---/--></i>');
  });

  it('builds them when the region arrives later', () => {
    const r = run(
      '<html :on=${null}><body><div :for-data=${on}><i :n=${7}>${n}</i></div></body></html>'
    );
    const live = () => r.markup();
    expect(live()).not.toContain('<i');
    r.ctx!.root.proxy['on'] = true;
    expect(live()).toContain('<i><!---t0-->7<!---/--></i>');
  });

  it('keeps them across a hide and a show', () => {
    // the element is moved rather than rebuilt, so what the DOM was holding
    // survives -- and so should the scopes that drive it
    const r = run(
      '<html :on=${true}><body><div :for-data=${on}><i :n=${3}>${n}</i></div></body></html>'
    );
    const live = () => r.markup();
    expect(live()).toContain('<i><!---t0-->3<!---/--></i>');
    r.ctx!.root.proxy['on'] = null;
    expect(live()).not.toContain('<i');
    r.ctx!.root.proxy['on'] = true;
    expect(live()).toContain('<i><!---t0-->3<!---/--></i>');
  });

  it('reads the region item from a child scope', () => {
    const r = run(
      '<html :u=${{ name: "Ada" }}><body><div :for-data=${u}>' +
        '<i :who=${data.name}>${who}</i></div></body></html>'
    );
    expect(r.runtime).toStrictEqual([]);
    expect(r.markup()).toContain('<i><!---t0-->Ada<!---/--></i>');
  });

  it('still evaluates nothing while there is nothing to show', () => {
    // the guarantee the directive is for: a child scope reading `data.name`
    // must not run against an absent item
    const r = run(
      '<html :u=${null}><body><div :for-data=${u}>' +
        '<i :who=${data.name}>${who}</i></div></body></html>'
    );
    expect(r.runtime).toStrictEqual([]);
    expect(r.markup()).not.toContain('<i');
  });
});
