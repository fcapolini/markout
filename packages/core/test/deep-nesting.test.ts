import { describe, expect, it } from 'vitest';
import { Page } from '../src/compiler/ir/Page';
import { stage1load } from '../src/compiler/stages/stage1-load';
import { stage2validate } from '../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../src/compiler/stages/stage7-generate';
import { parse } from '../src/html/parser';
import type { RuntimeError } from '../src/runtime/core/core-context';
import { WebContext } from '../src/runtime/web/web-context';
import { loadProps } from '../src/render/props';

/**
 * Three constructs deep, hand-picked rather than generated.
 *
 * matrix.test.ts crosses one binding with one container, which is where every
 * silent bug so far has lived. Depth three explodes combinatorially and most
 * of it is uninteresting -- but a few nestings are exactly where the
 * mechanisms compose: `callSiteScope()` recurses through enclosing instances,
 * and `replicaPath` accumulates through enclosing loops. These are those.
 *
 * Every definition deliberately declares `v` too, so a lookup that lands in
 * the wrong scope reads a different value rather than coincidentally finding
 * the page's and looking correct.
 */

function render(html: string) {
  const page = new Page(parse(html, 'deep.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  stage7generate(page);
  const runtime: RuntimeError[] = [];
  const ctx = page.errors.length
    ? undefined
    : new WebContext({
        ...loadProps(page.propsString),
        doc: page.source.doc,
        onError: e => runtime.push(e),
      }).refresh();
  return { page, ctx, errors: page.errors.map(e => e.msg), runtime };
}

/** live elements carrying `data-p`, skipping the inert <template> stencils */
function probes(doc: any): any[] {
  const found: any[] = [];
  const walk = (node: any, inTemplate: boolean) => {
    for (const n of node.childNodes ?? []) {
      if (n.nodeType !== 1) continue;
      const nested = inTemplate || n.tagName === 'TEMPLATE';
      if (!nested && n.getAttribute?.('data-p') !== null) found.push(n);
      walk(n.tagName === 'TEMPLATE' ? n.content : n, nested);
    }
  };
  walk(doc, false);
  return found;
}

function textOf(el: any): string {
  let out = '';
  for (const n of el.childNodes ?? []) {
    if (n.nodeType === 3) out += n.textContent;
    else if (n.nodeType === 1) out += textOf(n);
  }
  return out;
}

function texts(doc: any): string[] {
  return probes(doc).map(textOf);
}

const BADGE = '<:define tag="my-badge:span" :v="BADGE">${v}</:define>';
const BOX = '<:define tag="my-box:div" :v="BOX"><:slot /></:define>';

describe('three deep', () => {
  it('resolves a component parameter through a slot inside a loop', () => {
    // `:v=${data}` is written in the loop but lands on an instance sitting
    // inside ANOTHER instance's slot, so callSiteScope() has to walk out
    // through my-box before it finds the replica that owns `data`
    const { errors, runtime, page } = render(
      `<html :v=\${'PAGE'}><head>${BADGE}${BOX}</head><body>` +
        '<i :for-each=${["x", "y"]}>' +
        '<my-box><b data-p="1"><my-badge :v=${data} /></b></my-box>' +
        '</i></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(texts(page.source.doc)).toStrictEqual(['x', 'y']);
  });

  it('resolves text slotted through two nested components', () => {
    // doubly slotted: neither instance's own `v` may capture it
    const { errors, runtime, page } = render(
      `<html :v=\${'PAGE'}><head>${BOX}` +
        '<:define tag="my-outer:div" :v="OUTER"><:slot /></:define>' +
        '</head><body>' +
        '<my-outer><my-box><b data-p="1">${v}</b></my-box></my-outer>' +
        '</body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(texts(page.source.doc)).toStrictEqual(['PAGE']);
  });

  it('replicates a loop written inside slotted content', () => {
    // the replicas are slotted markup: they live in the instance but read
    // the page, and each still gets its own item
    const { errors, runtime, page } = render(
      `<html :v=\${'PAGE'}><head>${BOX}</head><body>` +
        '<my-box><b data-p="1" :for-each=${[1, 2]}>${v}-${data}</b></my-box>' +
        '</body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(texts(page.source.doc)).toStrictEqual(['PAGE-1', 'PAGE-2']);
  });

  it("replicates a component's own loop once per usage in a loop", () => {
    // two levels of replication that don't share a scope: the definition's
    // own :for-each, stamped out inside each replica of the page's
    const { errors, runtime, page } = render(
      '<html :v=${"PAGE"}><head>' +
        '<:define tag="my-list:u" :v="LIST" :items=${["a", "b"]}>' +
        '<b data-p="1" :for-each=${items}>${data}</b></:define>' +
        '</head><body><i :for-each=${[1, 2]}><my-list /></i></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(texts(page.source.doc)).toStrictEqual(['a', 'b', 'a', 'b']);
  });

  it('keeps $id distinct three deep', () => {
    const { errors, runtime, page } = render(
      `<html :v=\${'PAGE'}><head>${BOX}</head><body>` +
        '<i :for-each=${[1, 2]}><my-box>' +
        '<b data-p="1" :for-each=${[1, 2]} id="p-${$id}">x</b>' +
        '</my-box></i></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    const ids = probes(page.source.doc).map(e => e.getAttribute('id'));
    expect(ids.length).toBe(4);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).not.toContain('#');
  });

  it('propagates a change three deep', () => {
    const { errors, runtime, page, ctx } = render(
      `<html :v=\${'PAGE'}><head>${BADGE}${BOX}</head><body>` +
        '<i :for-each=${[1, 2]}>' +
        '<my-box><b data-p="1"><my-badge :v=${v + "-" + data} /></b></my-box>' +
        '</i></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(texts(page.source.doc)).toStrictEqual(['PAGE-1', 'PAGE-2']);

    ctx!.root.proxy['v'] = 'NEXT';
    expect(runtime).toStrictEqual([]);
    expect(texts(page.source.doc)).toStrictEqual(['NEXT-1', 'NEXT-2']);
  });
});
