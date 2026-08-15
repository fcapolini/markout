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
 * `$host` — the custom-tag instance this scope ended up INSIDE.
 *
 * `$parent` answers the other question: where the markup was written. The
 * two are the same thing until slotting separates them, and then a component
 * slotted into another has both a call site and a container, and needs to be
 * able to say which one it means.
 *
 * It exists for the coordination every component library needs: an accordion
 * item finding its accordion, a pane finding its tabs. What it deliberately
 * is NOT is a name a definition can read by accident -- reaching a container
 * takes writing `$host`, so the isolation between a definition and its call
 * site survives having a door in it.
 */
function run(html: string) {
  const page = new Page(parse(html, 'host.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  const errors = page.errors.map(e => e.msg);
  if (errors.length) return { errors, runtime: [], ctx: undefined, markup: () => '' };
  stage7generate(page);
  const runtime: RuntimeError[] = [];
  const ctx = new WebContext({
    root: new Function(`return (${page.propsString});`)(),
    doc: page.source.doc,
    onError: (e: RuntimeError) => runtime.push(e),
  }).refresh();
  return {
    ctx,
    errors,
    runtime: runtime.map(e => `${e.phase}: ${e.message}`),
    markup: () => {
      const s = page.source.doc.toString();
      return s.slice(s.indexOf('<body'), s.indexOf('<script'));
    },
  };
}

const GROUP = '<:define tag="my-group:div" class="group" :label="G"><:slot /></:define>';
const ITEM = '<:define tag="my-item:i" data-seen=${$host ? $host.label : "none"}>x</:define>';

describe('$host', () => {
  it('is the instance a component was slotted into', () => {
    const { errors, runtime, markup } = run(
      `<html><head>${GROUP}${ITEM}</head>` +
        '<body><my-group :label="outer"><my-item /></my-group></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(markup()).toContain('data-seen="outer"');
  });

  it('is nothing at all outside any instance', () => {
    // what lets a component stand on its own: no host, no coordination, and
    // no error either
    const { errors, runtime, markup } = run(
      `<html><head>${GROUP}${ITEM}</head><body><my-item /></body></html>`
    );
    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(markup()).toContain('data-seen="none"');
  });

  it('answers per usage, not per definition', () => {
    // the whole reason the compiler cannot resolve through it: one
    // definition, evaluated against whichever instance each usage sits in
    const { markup } = run(
      `<html><head>${GROUP}${ITEM}</head>` +
        '<body><my-group :label="one"><my-item /></my-group>' +
        '<my-group :label="two"><my-item /></my-group></body></html>'
    );
    expect(markup()).toContain('data-seen="one"');
    expect(markup()).toContain('data-seen="two"');
  });

  it('keeps up with what it reads', () => {
    const { ctx, markup } = run(
      `<html><head>${GROUP}${ITEM}</head>` +
        '<body><my-group :aka="g" :label="before"><my-item /></my-group></body></html>'
    );
    expect(markup()).toContain('data-seen="before"');

    ctx!.root.proxy.body.g.label = 'after';
    expect(markup()).toContain('data-seen="after"');
  });

  it('differs from $parent, which is where the markup was written', () => {
    // two things sitting in the same place, answering the two different
    // questions. The `<b>` was written at the call site, so its `$parent` is
    // the scope out there; the probe is a component sitting inside the box,
    // so its `$host` is the box. Swap the answers and both are wrong
    const { errors, runtime, markup } = run(
      '<html><head>' +
        '<:define tag="my-box:div" class="box" :who="box"><:slot /></:define>' +
        '<:define tag="my-probe:i" data-host=${$host ? $host.who : "-"}>x</:define>' +
        '</head>' +
        '<body><main :aka="app" :who="page">' +
        '<my-box><my-probe /><b data-parent=${$parent.who}>t</b></my-box>' +
        '</main></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(markup()).toContain('data-host="box"');
    expect(markup()).toContain('data-parent="page"');
  });

  it('composes, like $parent does', () => {
    const { errors, runtime, markup } = run(
      '<html><head>' +
        '<:define tag="my-outer:div" class="outer" :depth="1"><:slot /></:define>' +
        '<:define tag="my-inner:div" class="inner" :depth="2"><:slot /></:define>' +
        '<:define tag="my-leaf:i" data-up=${$host.$host ? $host.$host.depth : "-"}>x</:define>' +
        '</head>' +
        '<body><my-outer><my-inner><my-leaf /></my-inner></my-outer></body></html>'
    );
    expect(errors).toStrictEqual([]);
    expect(runtime).toStrictEqual([]);
    expect(markup()).toContain('data-up="1"');
  });
});
