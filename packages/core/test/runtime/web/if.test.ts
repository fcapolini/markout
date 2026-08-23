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
 * `:if` — renders the element when the expression is truthy.
 *
 * Two things distinguish it from `:for-data`, and both are the point.
 * Truthiness rather than `!= null`, so `0` and `''` mean what they mean in
 * JavaScript; and no item binding, since a condition is not something the
 * body wants and `data` inside should keep meaning what it meant outside.
 *
 * The name is a JS reserved word, which is exactly why it was available: a
 * value has to be something an expression can say, so `:if=${...}` was
 * already refused as a declaration. No page can have taken it.
 */
function run(html: string) {
  const page = new Page(parse(html, 'if.html'));
  // as Compiler.compile does: a parse error is a page error
  page.errors = page.source.errors;
  page.errors.length || stage1load(page);
  page.errors.length || stage2validate(page);
  page.errors.length || stage3qualify(page);
  page.errors.length || stage4resolve(page);
  const errors = page.errors.map(e => e.msg);
  if (errors.length) return { errors, runtime: [], ctx: undefined, live: () => '' };
  stage7generate(page);
  const runtime: RuntimeError[] = [];
  const ctx = new WebContext({
    ...loadProps(page.propsString),
    doc: page.source.doc,
    onError: (e: RuntimeError) => runtime.push(e),
  }).refresh();
  return {
    ctx,
    errors,
    runtime: runtime.map(e => `${e.phase}: ${e.message}`),
    /** what is actually in the page: stencils and their contents removed */
    live: () => {
      const s = page.source.doc.toString();
      return s
        .slice(s.indexOf('<body'), s.indexOf('<script'))
        .replace(/<template>[\s\S]*?<\/template>/g, '')
        .replace(/ data-markout="[^"]*"/g, '');
    },
  };
}

describe(':if', () => {
  it('renders when the expression is truthy', () => {
    const r = run('<html><body><p :if=${1 + 1}>here</p></body></html>');
    expect(r.errors).toStrictEqual([]);
    expect(r.runtime).toStrictEqual([]);
    expect(r.live()).toContain('<p>here</p>');
  });

  it('renders nothing, and evaluates nothing, when it is not', () => {
    // the same guarantee `:for-data` makes: a guard that still evaluates its
    // body is not a guard
    const r = run('<html :u=${null}><body><p :if=${u}>${u.boom.deep}</p></body></html>');
    expect(r.runtime).toStrictEqual([]);
    expect(r.live()).not.toContain('<p');
  });

  it('asks the question JavaScript asks, unlike :for-data', () => {
    // this is the whole reason it exists: `:for-data` is `!= null` so `0`
    // and `''` are data, which is right for an item and wrong for a condition
    const r = run(
      '<html :n=${0} :s=${""}><body>' +
        '<p :if=${n}>zero</p><p :if=${s}>empty</p>' +
        '<b :for-data=${n}>zero</b><b :for-data=${s}>empty</b>' +
        '</body></html>'
    );
    const live = r.live();
    expect(live).not.toContain('<p');
    // `:for-data` still shows both, which is what it is for
    expect(live.match(/<b>/g)).toHaveLength(2);
  });

  it('binds nothing, so `data` keeps meaning what it did outside', () => {
    const r = run(
      '<html><body><div :for-each=${["Ada"]}>' +
        '<p :if=${true}>${data}</p></div></body></html>'
    );
    expect(r.runtime).toStrictEqual([]);
    expect(r.live()).toContain('Ada');
  });

  it('appears and disappears as the condition changes', () => {
    const r = run('<html :on=${false}><body><p :if=${on}>hi <i :k=${7}>${k}</i></p></body></html>');
    expect(r.live()).not.toContain('<p');
    r.ctx!.root.proxy['on'] = true;
    // its child scope comes with it -- a region builds its subtree when it
    // stops being a stencil
    expect(r.live()).toContain('<i><!---t0-->7<!---/--></i>');
    r.ctx!.root.proxy['on'] = false;
    expect(r.live()).not.toContain('<p');
    r.ctx!.root.proxy['on'] = 'anything truthy';
    expect(r.live()).toContain('hi');
  });

  it('is refused alongside the other arities', () => {
    // all three answer "how many times does this render", so an element may
    // answer once
    expect(run('<html><body><p :if=${1} :for-each=${[1]}>x</p></body></html>').errors.join())
      .toMatch(/Cannot use ":if" with ":for-each"/);
    expect(run('<html><body><p :if=${1} :for-data=${1}>x</p></body></html>').errors.join())
      .toMatch(/Cannot use ":if" with ":for-data"/);
  });

  it('cannot be declared as a value, which is why the name was free', () => {
    // `${if}` does not parse, so this was already an error before `:if`
    // meant anything -- there is no page that could have been using it
    const r = run('<html><body><p>${if}</p></body></html>');
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
