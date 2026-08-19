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

/**
 * Every kind of binding, in every kind of container that relocates or
 * replicates the markup carrying it.
 *
 * Each construct here is covered on its own elsewhere. What kept breaking was
 * the PRODUCTS: a binding's DOM target is found by scanning its scope's
 * territory, and `:for-each`, `<:define>` and `<:slot>` all move or duplicate
 * markup out from under that assumption. Every silent bug found so far --
 * interpolated attributes, components in lists, slotted text, colliding
 * `$id`s -- was one cell of this table, so the table is generated rather than
 * written out: adding a row or a column covers all of its intersections at
 * once.
 */

// ---------------------------------------------------------------------------
// axes
// ---------------------------------------------------------------------------

/** the server DOM keeps textContent on text nodes, not on elements */
function textOf(el: any): string {
  let out = '';
  for (const n of el.childNodes ?? []) {
    if (n.nodeType === 3) out += n.textContent;
    else if (n.nodeType === 1) out += textOf(n);
  }
  return out;
}

/** each renders `v`, marked so the oracle can find it, on a <b> element */
const BINDINGS = [
  {
    name: 'text',
    markup: '<b data-probe="1">${v}</b>',
    read: textOf,
  },
  {
    name: 'attribute',
    markup: '<b data-probe="1" title=${v}>x</b>',
    read: (el: any) => el.getAttribute('title'),
  },
  {
    // browser-only by nature (a property isn't markup), so the oracle reads
    // it off the element rather than out of the served HTML -- what's being
    // checked here is that it reaches the RIGHT element in every container
    name: 'property',
    markup: '<b data-probe="1" :prop-probeProp=${v}>x</b>',
    read: (el: any) => el.probeProp,
  },
  {
    name: 'attribute presence',
    markup: '<b data-probe="1" :attr-flagged=${v === "A"}>x</b>',
    read: (el: any) => (el.getAttribute('flagged') === null ? 'B' : 'A'),
  },
  {
    name: 'class',
    markup: '<b data-probe="1" :class-on=${v === "A"}>x</b>',
    read: (el: any) => (el.getAttribute('class') ?? '').includes('on') ? 'A' : 'B',
  },
  {
    name: 'style',
    markup: '<b data-probe="1" :style-content=${v}>x</b>',
    read: (el: any) => (el.getAttribute('style') ?? '').includes('A') ? 'A' : 'B',
  },
  {
    name: 'scope value',
    markup: '<b data-probe="1" :inner=${v}>${inner}</b>',
    read: textOf,
  },
];

/**
 * each wraps binding markup so it ends up somewhere awkward. `count` is how
 * many probes should result, since replication multiplies them.
 */
const CONTAINERS = [
  {
    name: 'plain',
    wrap: (m: string) => ({ head: '', body: m }),
    count: 1,
  },
  {
    name: 'inside :for-each',
    wrap: (m: string) => ({ head: '', body: `<i :for-each=${'${[1, 2]}'}>${m}</i>` }),
    count: 2,
  },
  {
    name: 'inside nested :for-each',
    wrap: (m: string) => ({
      head: '',
      body: `<i :for-each=${'${[[1], [2, 3]]}'}><u :for-each=${'${data}'}>${m}</u></i>`,
    }),
    count: 3,
  },
  {
    name: 'inside a <:define> body',
    wrap: (m: string) => ({
      head: `<:define tag="my-one:div">${m}</:define>`,
      body: '<em :v="SHADOW"><my-one /></em>',
    }),
    count: 1,
  },
  {
    name: 'in a component used inside :for-each',
    wrap: (m: string) => ({
      head: `<:define tag="my-one:div">${m}</:define>`,
      body: `<i :for-each=${'${[1, 2]}'}><my-one /></i>`,
    }),
    count: 2,
  },
  {
    name: 'in a component inside a component',
    wrap: (m: string) => ({
      head:
        `<:define tag="my-inner:div">${m}</:define>` +
        '<:define tag="my-outer:div"><my-inner /></:define>',
      body: '<my-outer />',
    }),
    count: 1,
  },
  {
    name: 'in slotted content',
    wrap: (m: string) => ({
      head: '<:define tag="my-box:div" :v="SHADOW"><:slot /></:define>',
      body: `<em>\${v}</em><my-box>${m}</my-box><em>\${v}</em>`,
    }),
    count: 1,
  },
  {
    name: 'in slotted content inside :for-each',
    wrap: (m: string) => ({
      head: '<:define tag="my-box:div" :v="SHADOW"><:slot /></:define>',
      body: `<i :for-each=${'${[1, 2]}'}><my-box>${m}</my-box></i>`,
    }),
    count: 2,
  },
  {
    // the value reaches the binding through a usage-site attribute, which
    // evaluates at the call site while living on the instance
    name: 'via a component parameter',
    wrap: (m: string) => ({
      head: `<:define tag="my-p:div" :v="SHADOW">${m}</:define>`,
      body: '<em :w=${v}><my-p :v=${w} /></em>',
    }),
    count: 1,
  },
  {
    name: 'via a component parameter inside :for-each',
    wrap: (m: string) => ({
      head: `<:define tag="my-p:div" :v="SHADOW">${m}</:define>`,
      body: `<i :for-each=${'${[v, v]}'}><my-p :v=${'${data}'} /></i>`,
    }),
    count: 2,
  },
  {
    // the usage carries an attribute, which is the only thing that gives it a
    // scope of its own -- and a scope of its own is what sends expansion down
    // a different path for everything ELSE the usage brought with it. Slotted
    // content resolving at the call site had to be re-proved on that path:
    // every other slotted cell here uses an attribute-less usage
    name: 'in slotted content, usage carrying an attribute',
    wrap: (m: string) => ({
      head: `<:define tag="my-box:div" :v="SHADOW" :n=${'${0}'}><:slot /></:define>`,
      body: `<my-box :n=${'${1}'}>${m}</my-box>`,
    }),
    count: 1,
  },
  {
    // `:for-each` on the usage itself: the instance IS the replica, and the
    // name the loop declares has to reach the slotted markup without the
    // definition's own values reaching it too
    name: 'in slotted content of a replicated component',
    wrap: (m: string) => ({
      head: '<:define tag="my-box:div" :v="SHADOW"><:slot /></:define>',
      body: `<my-box :for-each=${'${[1, 2]}'}>${m}</my-box>`,
    }),
    count: 2,
  },
  {
    name: 'via a parameter of a replicated component',
    wrap: (m: string) => ({
      head: `<:define tag="my-p:div" :v="SHADOW">${m}</:define>`,
      body: `<my-p :for-each=${'${[v, v]}'} :v=${'${data}'} />`,
    }),
    count: 2,
  },
  {
    name: 'in a named slot',
    wrap: (m: string) => ({
      head:
        '<:define tag="my-box:div" :v="SHADOW">' +
        '<u><:slot name="s"><i :class-fallback>${v}</i></:slot></u></:define>',
      body: `<my-box><b :slot="s">${m}</b></my-box>`,
    }),
    count: 1,
  },
  {
    // a region that is showing is still a region: its markup arrived from a
    // stencil rather than being in the page, which is a different path to
    // the element every binding here has to find
    name: 'inside a showing :if',
    wrap: (m: string) => ({ head: '', body: `<i :if=${'${v}'}>${m}</i>` }),
    count: 1,
  },
  {
    name: 'inside a :for-data with something to show',
    wrap: (m: string) => ({ head: '', body: `<i :for-data=${'${v}'}>${m}</i>` }),
    count: 1,
  },
  {
    // the branch that renders is the one with no condition of its own, so
    // this also proves the chain decided rather than each branch answering
    // for itself -- two probes here would mean both branches were showing
    name: 'inside the :else of a chain',
    wrap: (m: string) => ({
      head: '',
      body: `<i :if=${'${!v}'}><b data-probe="1">nope</b></i><i :else>${m}</i>`,
    }),
    count: 1,
  },
  {
    // The three together, which is where they actually went wrong: a usage
    // filling a slot copies the scopes around it, and the copies were losing
    // the links that make a chain a chain -- so every branch answered for
    // itself, an `:else` compiles its condition to `true`, and both showed.
    //
    // Both slots are filled deliberately. Only a branch whose slot this usage
    // fills is copied, so filling one leaves the other holding its links and
    // the chain limps along correctly by accident. And the taken branch has
    // to be the FIRST: with the `:else` winning, a chain that never decided
    // reaches the same answer and proves nothing. The decoy probe in the
    // losing branch is what turns "both showed" into a count of two.
    name: 'in a named slot inside a definition that branches',
    wrap: (m: string) => ({
      head:
        '<:define tag="my-box:div" :v="SHADOW">' +
        `<i :if=${'${v}'}><:slot name="on" /></i>` +
        '<i :else><:slot name="off" /></i></:define>',
      body:
        `<my-box><span :slot="on">${m}</span>` +
        '<b :slot="off" data-probe="1">nope</b></my-box>',
    }),
    count: 1,
  },
];

// ---------------------------------------------------------------------------
// oracle
// ---------------------------------------------------------------------------

function compile(html: string) {
  const page = new Page(parse(html, 'matrix.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  stage7generate(page);
  return page;
}

function probes(doc: any): any[] {
  const found: any[] = [];
  const walk = (node: any, inTemplate: boolean) => {
    for (const n of node.childNodes ?? []) {
      if (n.nodeType !== 1) continue;
      const nested = inTemplate || n.tagName === 'TEMPLATE';
      // a <template> holds an inert stencil: it renders, but is never live
      if (!nested && n.getAttribute?.('data-probe') !== null) found.push(n);
      walk(n.tagName === 'TEMPLATE' ? n.content : n, nested);
    }
  };
  walk(doc, false);
  return found;
}

function check(binding: (typeof BINDINGS)[number], container: (typeof CONTAINERS)[number]) {
  const { head, body } = container.wrap(binding.markup);
  const page = compile(
    `<html :v=\${'A'}><head>${head}</head><body>${body}</body></html>`
  );

  // 1. it compiles
  expect(page.errors.map(e => e.msg)).toStrictEqual([]);

  // 2. server rendering raises nothing -- including the unbound-binding
  //    report, which is what catches a value whose DOM target went missing
  const ssrErrors: RuntimeError[] = [];
  const root = new Function(`return (${page.propsString});`)();
  const ctx = new WebContext({
    root,
    doc: page.source.doc,
    onError: e => ssrErrors.push(e),
  }).refresh();
  expect(ssrErrors).toStrictEqual([]);

  // 3. nothing was silently dropped: the expected number of probes exist and
  //    all show the value, and no compiler-only markup survived
  const found = probes(page.source.doc);
  expect(found.length).toBe(container.count);
  for (const el of found) {
    expect(binding.read(el)).toContain('A');
  }
  const markup = page.source.doc.toString();
  expect(markup).not.toMatch(/<my-[a-z]+[\s/>]/);
  expect(markup).not.toMatch(/\s:[a-z-]+=/);
  expect(markup).not.toContain(':slot');

  // 4. a dependency change reaches every one of them
  ctx.root.proxy['v'] = 'B';
  expect(ssrErrors).toStrictEqual([]);
  for (const el of probes(page.source.doc)) {
    expect(binding.read(el)).toContain('B');
  }

  // 5. re-running the compiled props over the served DOM is what the browser
  //    does on hydration: it must settle on the same markup, not double up
  const served = page.source.doc.toString();
  const rehydrated = parse(served, 'matrix.html');
  const hydrationErrors: RuntimeError[] = [];
  new WebContext({
    root: new Function(`return (${page.propsString});`)(),
    doc: rehydrated.doc,
    onError: e => hydrationErrors.push(e),
  }).refresh();
  expect(hydrationErrors).toStrictEqual([]);
  expect(probes(rehydrated.doc).length).toBe(container.count);
}

// ---------------------------------------------------------------------------

/**
 * Wrappers that go AROUND a whole container, so the table crosses pairs of
 * mechanisms rather than one at a time.
 *
 * The single-container table catches a binding whose DOM target one construct
 * moved. What it cannot catch is two constructs disagreeing about the same
 * markup -- and every silent bug this session turned up was exactly that
 * shape: a chain inside a definition worked, a chain in slotted content
 * worked, and the two together did not.
 *
 * These four are the mechanisms that relocate or replicate: a loop, a region,
 * a branch, and a slot. Their tag names are their own (`wrap-`) so composing
 * one around a container cannot collide with the tags that container
 * declares, which is what lets this be generated rather than written out.
 */
const WRAPPERS = [
  {
    name: 'in a :for-each',
    wrap: (head: string, body: string) => ({
      head,
      body: `<u :for-each=${'${[1, 2]}'}>${body}</u>`,
    }),
    count: 2,
  },
  {
    name: 'in a showing :if',
    wrap: (head: string, body: string) => ({
      head,
      body: `<u :if=${'${v}'}>${body}</u>`,
    }),
    count: 1,
  },
  {
    name: 'in the :else of a chain',
    wrap: (head: string, body: string) => ({
      head,
      body: `<u :if=${'${!v}'}>x</u><u :else>${body}</u>`,
    }),
    count: 1,
  },
  {
    name: 'slotted into a component',
    wrap: (head: string, body: string) => ({
      head: `${head}<:define tag="wrap-box:div" :v="SHADOW"><:slot /></:define>`,
      body: `<wrap-box>${body}</wrap-box>`,
    }),
    count: 1,
  },
];

for (const wrapper of WRAPPERS) {
  for (const container of CONTAINERS) {
    describe(`binding ${container.name} ${wrapper.name}`, () => {
      for (const binding of BINDINGS) {
        it(`binds ${binding.name}`, () => {
          const inner = container.wrap(binding.markup);
          const { head, body } = wrapper.wrap(inner.head, inner.body);
          check(binding, {
            name: `${container.name} ${wrapper.name}`,
            wrap: () => ({ head, body }),
            count: container.count * wrapper.count,
          });
        });
      }
    });
  }
}

for (const container of CONTAINERS) {
  describe(`binding ${container.name}`, () => {
    for (const binding of BINDINGS) {
      it(`binds ${binding.name}`, () => check(binding, container));
    }
  });
}

describe('$id across containers', () => {
  // $id gets its own pass: its contract is uniqueness, not a value, so the
  // oracle above can't express it
  for (const container of CONTAINERS) {
    it(`is distinct per instance ${container.name}`, () => {
      const { head, body } = container.wrap('<b data-probe="1" id="p-${$id}">x</b>');
      const page = compile(
        `<html :v=\${'A'}><head>${head}</head><body>${body}</body></html>`
      );
      expect(page.errors.map(e => e.msg)).toStrictEqual([]);

      const errors: RuntimeError[] = [];
      new WebContext({
        root: new Function(`return (${page.propsString});`)(),
        doc: page.source.doc,
        onError: e => errors.push(e),
      }).refresh();
      expect(errors).toStrictEqual([]);

      const ids = probes(page.source.doc).map(e => e.getAttribute('id'));
      expect(ids.length).toBe(container.count);
      expect(new Set(ids).size).toBe(ids.length);
      // usable as an HTML id: no `#`, which would be legal markup that no
      // selector can match
      for (const id of ids) expect(id).not.toContain('#');
    });
  }
});
