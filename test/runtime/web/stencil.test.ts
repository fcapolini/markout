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

/**
 * A `:for-each` host is a stencil, not a rendering.
 *
 * Its element is compiled into an inert `<template>` and everything a reader
 * sees is a clone. The host used to build and evaluate its whole subtree
 * anyway, which is wrong in a way that only shows up at the edges: those
 * scopes read a per-item name that is never set, so an expression that is
 * perfectly safe per item (`item.badge.name`) threw, and a `:handle-` ran for
 * an element sitting inside a `<template>` -- handing a third-party plugin an
 * element that is not in the page.
 */
function run(html: string) {
  const page = new Page(parse(html, 'stencil.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  stage7generate(page);
  const runtime: RuntimeError[] = [];
  const ctx = new WebContext({
    root: new Function(`return (${page.propsString});`)(),
    doc: page.source.doc,
    onError: (e: RuntimeError) => runtime.push(e),
  }).refresh();
  const markup = page.source.doc.toString();
  return {
    ctx,
    errors: page.errors.map(e => e.msg),
    runtime: runtime.map(e => `${e.phase}: ${e.message}`),
    markup,
    /** what the reader sees: the live clones, never a stencil */
    body: markup
      .slice(markup.indexOf('<body'))
      .replace(/<template>[\s\S]*?<\/template>/g, '')
      .replace(/<!--.*?-->/g, '')
      .replace(/ data-markout="[^"]*"/g, ''),
  };
}

describe('a :for-each host does not evaluate its subtree', () => {
  it('reaches into the item from a nested scope without touching the stencil', () => {
    // the crash this pins: `item.tag` is fine for every item and impossible
    // in the host, where there is no item at all
    const { errors, runtime, body } = run(
      '<html><body><div :for-each=${[{ tag: "a" }, { tag: "b" }]} :for-as="item">' +
        '<span :n=${item.tag}>${n}</span></div></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(body).toContain('>a<');
    expect(body).toContain('>b<');
  });

  it('leaves the stencil unwritten rather than binding it like a replica', () => {
    // the host's own values are prototypes for the clones, which build their
    // own; evaluating them here only ever wrote into markup nobody sees
    const { markup } = run(
      '<html><body><ul><li :for-each=${["x"]} :n=${"visible"}>${n}</li></ul></body></html>'
    );

    const stencil = markup.slice(markup.indexOf('<template>'), markup.indexOf('</template>'));
    expect(stencil).toContain('<li');
    expect(stencil).not.toContain('visible');
    expect(markup.slice(markup.indexOf('</template>'))).toContain('visible');
  });

  it('still replicates when the host carries a custom tag', () => {
    // the host is an instance as well as a stencil, so skipping its subtree
    // must not skip the instance's own body for the clones
    const { errors, runtime, body } = run(
      '<html><head><:define tag="my-tag:span" :label="">[${label}]</:define></head>' +
        '<body><my-tag :for-each=${["a", "b"]} :label=${data} /></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(body).toContain('[a]');
    expect(body).toContain('[b]');
  });

  it('does not run a definition\'s :handle- for the stencil', () => {
    // `:handle-` is the imperative door, so running it for an element inside
    // a <template> is the one case that reaches outside the page entirely
    const { ctx, errors, runtime, body } = run(
      '<html :seen=${[]}><head>' +
        '<:define tag="my-tag:span" :label="" :handle-label=${(v) => { page.seen.push(v); }}>' +
        '${label}</:define></head>' +
        '<body><my-tag :for-each=${["a", "b"]} :label=${data} /></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(body).toContain('a');
    expect(body).toContain('b');
    // once per replica and no more: a third call is the stencil's, made with
    // whatever the unset item evaluates to
    expect(ctx.root.proxy.seen).toStrictEqual(['a', 'b']);
  });
});
