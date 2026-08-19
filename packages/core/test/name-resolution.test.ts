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
 * `:aka` names, resolved by BOTH halves and checked against each other.
 *
 * Where a name is registered and where a lookup continues are two questions
 * with two answers, and each is implemented twice: `Scope.nameSite()` and
 * `Scope.resolvesVia()` in the compiler, `CoreScope.nameSiteScope()` and
 * `CoreScope.lexicalParent()` in the runtime. Two implementations of one rule
 * in two languages is the classic place for a silent divergence, and the
 * failure it produces is the worst shape this project has: the page compiles
 * clean, and the browser reports `Cannot read properties of undefined
 * (reading '$value')` -- which names nothing the author wrote, and which the
 * runtime is entitled to treat as a markout bug rather than a page bug.
 *
 * The tests for these walks used to stop at stage 4: they asserted what the
 * COMPILER resolved and never linked it, so the other half of the rule was
 * unchecked. Everything below compiles and links, and reads the value back.
 *
 * Every case plants a decoy of the same name in the scope a wrong walk would
 * land in, so landing there reads "WRONG" rather than coincidentally finding
 * the right thing.
 */

/** the box every slotted case is written into; its own `open` is the decoy */
const BOX = '<:define tag="my-box:div" :open=${"WRONG"}><:slot /></:define>';

function run(html: string) {
  const page = new Page(parse(html, 'names.html'));
  page.errors = page.source.errors;
  page.errors.length || stage1load(page);
  page.errors.length || stage2validate(page);
  page.errors.length || stage3qualify(page);
  page.errors.length || stage4resolve(page);
  const errors = page.errors.map(e => e.msg);
  if (errors.length) return { errors, runtime: [] as string[], read: '' };
  stage7generate(page);
  const runtime: RuntimeError[] = [];
  new WebContext({
    root: new Function(`return (${page.propsString});`)(),
    doc: page.source.doc,
    onError: (e: RuntimeError) => runtime.push(e),
  }).refresh();
  const s = page.source.doc.toString();
  const body = s
    .slice(s.indexOf('<body'), s.indexOf('<script'))
    .replace(/<template>[\s\S]*?<\/template>/g, '')
    .replace(/<!--.*?-->/g, '');
  return {
    errors,
    runtime: runtime.map(e => `${e.phase}: ${e.message}`),
    read: /<i>([\s\S]*?)<\/i>/.exec(body)?.[1] ?? '(no probe)',
  };
}

/** compiles, links, and reads the value the markup says it should */
function reaches(html: string) {
  const r = run(html);
  expect(r.errors).toStrictEqual([]);
  expect(r.runtime).toStrictEqual([]);
  expect(r.read).toBe('RIGHT');
}

describe('a name the page can reach', () => {
  it('nests the way the markup nests', () => {
    reaches(
      '<html><body><div :aka="ui"><span :aka="pane" :open=${"RIGHT"}></span></div>' +
        '<i>${ui.pane.open}</i></body></html>'
    );
  });

  it('belongs to the named tag it was slotted into', () => {
    reaches(
      `<html><head>${BOX}</head><body>` +
        '<my-box :aka="toasts"><span :aka="shipped" :open=${"RIGHT"}></span></my-box>' +
        '<i>${toasts.shipped.open}</i></body></html>'
    );
  });

  it('is reachable as itself through an UNNAMED tag, which is transparent', () => {
    reaches(
      `<html><head>${BOX}</head><body>` +
        '<my-box><span :aka="shipped" :open=${"RIGHT"}></span></my-box>' +
        '<i>${shipped.open}</i></body></html>'
    );
  });

  it('nests through two slotted tags', () => {
    reaches(
      `<html><head>${BOX}</head><body>` +
        '<my-box :aka="outer"><my-box :aka="inner">' +
        '<span :aka="leaf" :open=${"RIGHT"}></span></my-box></my-box>' +
        '<i>${outer.inner.leaf.open}</i></body></html>'
    );
  });

  it('names the instance itself, and reads what the usage set on it', () => {
    reaches(
      `<html><head>${BOX}</head><body>` +
        '<my-box :aka="boxy" :open=${"RIGHT"} />' +
        '<i>${boxy.open}</i></body></html>'
    );
  });

  it('reads a value ON a region host, which exists whether it shows or not', () => {
    // the region's own condition is read this way, so this must keep working
    reaches(
      '<html :on=${true}><body>' +
        '<div :aka="ui" :if=${on} :open=${"RIGHT"}></div>' +
        '<i>${ui.open}</i></body></html>'
    );
  });

  it('reads a name inside a region from inside the same region', () => {
    // everything in there is built together, and stops existing together
    reaches(
      '<html :on=${true}><body><div :aka="ui" :if=${on}>' +
        '<span :aka="pane" :open=${"RIGHT"}></span><i>${ui.pane.open}</i>' +
        '</div></body></html>'
    );
  });
});

describe('a name inside a region, read from outside it', () => {
  // Refused rather than left to fail at link time. What is inside a region is
  // not built while the region is a stencil, so its scopes do not exist and
  // have registered no name -- there is nothing for the dependency to find.
  const cases: [string, string, RegExp][] = [
    [
      ':if',
      '<html :on=${true}><body><div :aka="ui" :if=${on}>' +
        '<span :aka="pane" :open=${1}></span></div>' +
        '<i>${ui.pane.open}</i></body></html>',
      /takes it away again/,
    ],
    [
      ':for-data',
      '<html :d=${1}><body><div :aka="ui" :for-data=${d}>' +
        '<span :aka="pane" :open=${1}></span></div>' +
        '<i>${ui.pane.open}</i></body></html>',
      /takes it away again/,
    ],
    [
      ':for-each',
      '<html><body><div :aka="ui" :for-each=${[1, 2]}>' +
        '<span :aka="pane" :open=${1}></span></div>' +
        '<i>${ui.pane.open}</i></body></html>',
      /once per item/,
    ],
    [
      'an :else branch',
      '<html :on=${true}><body><div :if=${!on}>x</div>' +
        '<div :aka="ui" :else><span :aka="pane" :open=${1}></span></div>' +
        '<i>${ui.pane.open}</i></body></html>',
      /takes it away again/,
    ],
  ];

  for (const [what, html, why] of cases) {
    it(`refuses it through ${what}, and says why`, () => {
      const r = run(html);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatch(/Cannot read "pane.open" through "ui"/);
      expect(r.errors[0]).toMatch(why);
      // and points at the way out, which is not obvious from the failure
      expect(r.errors[0]).toMatch(/Declare what the outside needs to read outside the region/);
    });
  }

  it('names the directive as the page spelled it', () => {
    const r = run(
      '<html :on=${true}><body><div :if=${!on}>x</div>' +
        '<div :aka="ui" :else><span :aka="pane" :open=${1}></span></div>' +
        '<i>${ui.pane.open}</i></body></html>'
    );
    // `:else` compiles to the same value `:if` does, and being told about an
    // ":if" that is not in the source is a puzzle rather than a report
    expect(r.errors[0]).toContain('":else"');
  });

  it('refuses it through a region inside a component too', () => {
    const r = run(
      '<html><head><:define tag="my-b:div">' +
        '<div :if=${true}><:slot /></div></:define></head><body>' +
        '<my-b :aka="bx"><span :aka="pane" :open=${1}></span></my-b>' +
        '<i>${bx.pane.open}</i></body></html>'
    );
    expect(r.errors.join()).toMatch(/Cannot read "pane.open" through "bx"/);
  });
});
