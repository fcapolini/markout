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
const BOX = '<:define tag="my-box:div" ::open=${"WRONG"}><:slot /></:define>';

function run(html: string) {
  const page = new Page(parse(html, 'names.html'));
  page.errors = page.source.errors;
  page.errors.length || stage1load(page);
  page.errors.length || stage2validate(page);
  page.errors.length || stage3qualify(page);
  page.errors.length || stage4resolve(page);
  const errors = page.errors.map(e => e.msg);
  const runtime: RuntimeError[] = [];
  if (errors.length) {
    return { errors, runtime, ctx: undefined, read: () => '' };
  }
  stage7generate(page);
  const ctx = new WebContext({
    ...loadProps(page.props!),
    doc: page.source.doc,
    onError: (e: RuntimeError) => runtime.push(e),
  }).refresh();
  return {
    errors,
    /** read after each change, not snapshotted: half of these drive the page */
    runtime: runtime as unknown as string[],
    ctx,
    read: () => {
      const s = page.source.doc.toString();
      const body = s
        .slice(s.indexOf('<body'), s.indexOf('<script'))
        .replace(/<!--.*?-->/g, '');
      return /<i>([\s\S]*?)<\/i>/.exec(body)?.[1] ?? '(no probe)';
    },
  };
}

/** the same, with a context this test is going to drive */
function live(html: string) {
  const r = run(html);
  return { ...r, ctx: r.ctx! };
}

/** compiles, links, and reads the value the markup says it should */
function reaches(html: string) {
  const r = run(html);
  expect(r.errors).toStrictEqual([]);
  expect(r.runtime).toStrictEqual([]);
  expect(r.read()).toBe('RIGHT');
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
        '<my-box :aka="boxy" ::open=${"RIGHT"} />' +
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

describe('a name inside a region', () => {
  /** the shape every case here is a variation of */
  const REGION =
    '<div :aka="panel" :if=${on}><span :aka="field" :text=${msg}></span></div>';

  it('is read with "?." and is undefined while the region is away', () => {
    // the whole cycle, because every stage of it has its own way to be wrong.
    // Reading the last thing it saw would be worse than the compile error
    // this replaced: wrong AND silent, where that was merely unhelpful
    const r = live(
      '<html :on=${false} :msg=${"A"}><body>' +
        REGION +
        '<i>${panel.field?.text ?? "away"}</i></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.runtime).toStrictEqual([]);
    expect(r.read()).toBe('away');

    r.ctx.root.proxy['on'] = true;
    expect(r.read()).toBe('A');

    // a change INSIDE the region reaches the reader outside it: the edge is
    // made when the region appears, not merely the value copied
    r.ctx.root.proxy['msg'] = 'B';
    expect(r.read()).toBe('B');

    r.ctx.root.proxy['on'] = false;
    expect(r.read()).toBe('away');

    r.ctx.root.proxy['on'] = true;
    expect(r.read()).toBe('B');
    expect(r.runtime).toStrictEqual([]);
  });

  it('refuses the unguarded read, and shows the guarded spelling', () => {
    const r = run(
      '<html :on=${true} :msg=${"A"}><body>' +
        REGION +
        '<i>${panel.field.text}</i></body></html>'
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/"field" is inside a ":if"/);
    expect(r.errors[0]).toMatch(/Read it as "panel\.field\?\.text"/);
  });

  /**
   * The same rule, with the region host UNNAMED -- which is what makes the
   * name that lands inside the FIRST segment of the chain rather than the
   * second. Every case above reaches `panel.field`, so there was always a
   * segment before the crossing to name; here there is not, and reading
   * `segments[at - 1]` for it threw `Cannot read properties of undefined`
   * out of the compiler instead of reporting anything. The `?.` case threw
   * too, since the name was built before the guard was checked -- so the
   * crash landed on the one spelling that was supposed to be accepted.
   */
  const BARE = '<div :if=${on}><span :aka="field" :text=${msg}></span></div>';

  it('refuses the unguarded read with no host to name', () => {
    const r = run(
      '<html :on=${true} :msg=${"A"}><body>' +
        BARE +
        '<i>${field.text}</i></body></html>'
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/"field" is inside a ":if"/);
    expect(r.errors[0]).toMatch(/Read it as "field\?\.text"/);
    // the wording that has nothing to fill it in
    expect(r.errors[0]).not.toMatch(/through/);
  });

  it('accepts the guarded read with no host to name', () => {
    const r = live(
      '<html :on=${false} :msg=${"A"}><body>' +
        BARE +
        '<i>${field?.text ?? "away"}</i></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.read()).toBe('away');

    r.ctx.root.proxy['on'] = true;
    expect(r.read()).toBe('A');

    r.ctx.root.proxy['on'] = false;
    expect(r.read()).toBe('away');
    expect(r.runtime).toStrictEqual([]);
  });

  it('sends an assignment with no host to name to $set', () => {
    const r = run(
      '<html :on=${true} :msg=${"A"}><body>' +
        BARE +
        '<button :on-click=${() => field.text = "X"}>b</button></body></html>'
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/Cannot assign to "field\.text":/);
    expect(r.errors[0]).toMatch(/Write it as "field\?\.\$set\('text', \.\.\.\)"/);
    expect(r.errors[0]).not.toMatch(/through/);
  });

  it('refuses a :for-each with no host to name, and gets to say why', () => {
    // this one had the message ready and crashed before printing it
    const r = run(
      '<html><body><div :for-each=${[1, 2]}>' +
        '<span :aka="pane" :open=${1}></span></div>' +
        '<i>${pane?.open}</i></body></html>'
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/once per item/);
    expect(r.errors[0]).not.toMatch(/through/);
  });

  it('names the directive as the page spelled it', () => {
    // `:else` compiles to the same value `:if` does, and being told about an
    // ":if" that is not in the source is a puzzle rather than a report
    const r = run(
      '<html :on=${true}><body><div :if=${!on}>x</div>' +
        '<div :aka="panel" :else><span :aka="field" :text=${1}></span></div>' +
        '<i>${panel.field.text}</i></body></html>'
    );
    expect(r.errors[0]).toContain('":else"');
  });

  it('writes into it with $set, which a call can guard', () => {
    // `a?.b = c` is not JavaScript and `a?.b(c)` is, so a write spelled as a
    // call inherits the guard the read already has
    const r = live(
      '<html :on=${false} :msg=${"A"}><body>' +
        REGION +
        '<i>${panel.field?.text ?? "away"}</i>' +
        '<:logic :aka="w" :write=${() => panel.field?.$set("text", "X")} />' +
        '</body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    const write = () => r.ctx.root.proxy['body']['w'].write();

    // away: the call does not happen, so the whole expression is undefined
    expect(write()).toBe(undefined);
    expect(r.read()).toBe('away');

    r.ctx.root.proxy['on'] = true;
    // there: it lands, and answers that it did
    expect(write()).toBe(true);
    expect(r.read()).toBe('X');
    expect(r.runtime).toStrictEqual([]);
  });

  it('checks the name $set is given, since it is a string', () => {
    // an unchecked name would be a write that quietly lands nowhere, which is
    // the failure `$set` exists to have a spelling for
    const r = run(
      '<html :on=${true} :msg=${"A"}><body>' +
        REGION +
        '<:logic :write=${() => panel.field?.$set("txet", "X")} /></body></html>'
    );
    expect(r.errors).toStrictEqual(['Unknown reference: "txet"']);
  });

  it('refuses a name $set cannot be checked against', () => {
    const r = run(
      '<html :on=${true} :msg=${"A"} :k=${"text"}><body>' +
        REGION +
        '<:logic :write=${() => panel.field?.$set(k, "X")} /></body></html>'
    );
    expect(r.errors.join()).toMatch(/needs the name as a literal/);
  });

  it('tells an unguarded $set to become a guarded call, not a read', () => {
    const r = run(
      '<html :on=${true} :msg=${"A"}><body>' +
        REGION +
        '<:logic :write=${() => panel.field.$set("text", "X")} /></body></html>'
    );
    expect(r.errors.join()).toMatch(/Call it as "panel\.field\?\.\$set\(\.\.\.\)"/);
    expect(r.errors.join()).toMatch(/answers whether it did/);
  });

  it('sends a plain assignment to $set, since "?." cannot go left of "="', () => {
    const r = run(
      '<html :on=${true} :msg=${"A"}><body>' +
        REGION +
        '<button :on-click=${() => panel.field.text = "X"}>b</button></body></html>'
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/Cannot assign to "field\.text" through "panel"/);
    // and names the spelling that works, rather than only what does not
    expect(r.errors[0]).toMatch(/Write it as "panel\.field\?\.\$set\('text', \.\.\.\)"/);
  });

  it('refuses a :for-each even when guarded', () => {
    // `?.` says "this may be absent", and a loop's trouble is not absence: the
    // name means as many scopes as there are items. Offered exactly where the
    // arity is zero-or-one
    const r = run(
      '<html><body><div :aka="ui" :for-each=${[1, 2]}>' +
        '<span :aka="pane" :open=${1}></span></div>' +
        '<i>${ui.pane?.open}</i></body></html>'
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/once per item/);
  });

  it('guards a region that belongs to a component, not to the page', () => {
    // the structural half of the rule: markup slotted into a component
    // resolves its names at the call site but LIVES where the definition put
    // it, which here is inside a region of the component's own
    const r = live(
      '<html :on=${true}><head><:define tag="my-b:div">' +
        '<div :if=${true}><:slot /></div></:define></head><body>' +
        '<my-b :aka="bx"><span :aka="pane" :text=${"RIGHT"}></span></my-b>' +
        '<i>${bx.pane?.text ?? "away"}</i></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.runtime).toStrictEqual([]);
    expect(r.read()).toBe('RIGHT');
  });

  it('needs no guard for a value ON the region host', () => {
    reaches(
      '<html :on=${true}><body>' +
        '<div :aka="ui" :if=${on} :open=${"RIGHT"}></div>' +
        '<i>${ui.open}</i></body></html>'
    );
  });

  it('needs no guard from inside the same region', () => {
    reaches(
      '<html :on=${true}><body><div :aka="ui" :if=${on}>' +
        '<span :aka="pane" :open=${"RIGHT"}></span><i>${ui.pane.open}</i>' +
        '</div></body></html>'
    );
  });
});
