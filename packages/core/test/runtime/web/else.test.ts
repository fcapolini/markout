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
 * `:else-if` and `:else` — the branches after an `:if`.
 *
 * All three compile to one value, because they answer one question at one
 * arity: does this element render. What the two new spellings add is a link
 * to the branch before them, and the rule that the first condition to hold
 * takes the position and the rest give it up.
 *
 * That rule is the whole reason they exist. Two `:if`s can already say
 * "when a, and when not a", and get it wrong in the way this file mostly
 * tests: the branch that has to change is the one whose own condition did
 * not, so nothing wakes it, and both are shown or neither is.
 *
 * Position is also all an `:else` has to say which condition it answers,
 * which is why adjacency is a rule rather than a style, and why breaking it
 * is a compile error rather than a shrug.
 */
function run(html: string) {
  const page = new Page(parse(html, 'else.html'));
  // as Compiler.compile does: a parse error is a page error
  page.errors = page.source.errors;
  page.errors.length || stage1load(page);
  page.errors.length || stage2validate(page);
  page.errors.length || stage3qualify(page);
  page.errors.length || stage4resolve(page);
  const errors = page.errors.map(e => e.msg);
  if (errors.length) return { errors, runtime: [], ctx: undefined, doc: undefined, live: () => '' };
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
    doc: page.source.doc,
    runtime: runtime.map(e => `${e.phase}: ${e.message}`),
    /** what is actually in the page: every stencil is elsewhere, in <head> */
    live: () => {
      const s = page.source.doc.toString();
      return s
        .slice(s.indexOf('<body'), s.indexOf('<script'))
        .replace(/ data-markout="[^"]*"/g, '')
        .replace(/<!--.*?-->/g, '');
    },
  };
}

/** the three-way chain most of these cases drive */
const CHAIN =
  '<html :n=${2}><body>' +
  '<p :if=${n === 1}>one</p>' +
  '<p :else-if=${n === 2}>two</p>' +
  '<p :else>many</p>' +
  '</body></html>';

describe(':else-if / :else', () => {
  it('shows the first branch whose condition holds', () => {
    const r = run(CHAIN);
    expect(r.errors).toStrictEqual([]);
    expect(r.runtime).toStrictEqual([]);
    expect(r.live()).toContain('<p>two</p>');
    expect(r.live()).not.toContain('one');
    expect(r.live()).not.toContain('many');
  });

  it('falls through to :else when none of them do', () => {
    const r = run(CHAIN);
    r.ctx!.root.proxy['n'] = 7;
    expect(r.live()).toContain('<p>many</p>');
  });

  it('moves the choice when an EARLIER condition changes', () => {
    // the case two `:if`s cannot express. `n` going 2 -> 1 leaves the second
    // branch's own condition exactly as it was, so nothing it reads has
    // changed and nothing would wake it; it has to give up the position
    // because something before it took it
    const r = run(CHAIN);
    expect(r.live()).toContain('two');
    r.ctx!.root.proxy['n'] = 1;
    expect(r.live()).toContain('<p>one</p>');
    expect(r.live()).not.toContain('two');
    expect(r.runtime).toStrictEqual([]);
  });

  it('shows nothing at all when a chain without :else runs out', () => {
    const r = run(
      '<html :n=${3}><body><p :if=${n === 1}>one</p><p :else-if=${n === 2}>two</p></body></html>'
    );
    expect(r.live()).not.toContain('<p');
    r.ctx!.root.proxy['n'] = 2;
    expect(r.live()).toContain('<p>two</p>');
  });

  it('asks the same question :if does', () => {
    // truthiness, not `!= null`: the branches are one directive under three
    // spellings, so `0` and `''` fail here exactly as they fail there
    const r = run(
      '<html :n=${0}><body><p :if=${n}>truthy</p><p :else>falsy</p></body></html>'
    );
    expect(r.live()).toContain('falsy');
    r.ctx!.root.proxy['n'] = 'x';
    expect(r.live()).toContain('truthy');
  });

  it('evaluates nothing in the branches that lost', () => {
    // the guarantee `:if` makes, which is worth restating here because a
    // chain has losers by construction rather than by accident
    const r = run(
      '<html :u=${null}><body>' +
        '<p :if=${u}>${u.boom.deep}</p><p :else>fine</p>' +
        '</body></html>'
    );
    expect(r.runtime).toStrictEqual([]);
    expect(r.live()).toContain('fine');
  });

  it('keeps the losing branches live enough to come back', () => {
    // hidden markup is parked in its stencil, not rebuilt, and its condition
    // stays linked -- otherwise a branch that lost once would lose forever
    const r = run(CHAIN);
    r.ctx!.root.proxy['n'] = 1;
    r.ctx!.root.proxy['n'] = 2;
    r.ctx!.root.proxy['n'] = 1;
    expect(r.live()).toContain('<p>one</p>');
    expect(r.live().match(/<p>/g)).toHaveLength(1);
  });

  it('decides per replica inside a :for-each', () => {
    const r = run(
      '<html><body><div :for-each=${[1, 2, 9]}>' +
        '<i :if=${data === 1}>one</i><i :else-if=${data === 2}>two</i><i :else>big</i>' +
        '</div></body></html>'
    );
    expect(r.runtime).toStrictEqual([]);
    // every replica shares the branches' compiled props, ids included, so
    // each has to find its neighbours in its OWN copy of them
    const live = r.live();
    expect(live).toContain('<i>one</i>');
    expect(live).toContain('<i>two</i>');
    expect(live).toContain('<i>big</i>');
    expect(live.match(/<i>/g)).toHaveLength(3);
  });

  it('decides per instance of a <:define>', () => {
    // every instance builds its scopes from the definition's props, branch
    // ids and all, so a chain in there is found within the instance rather
    // than across the page
    const r = run(
      '<html :bump=${0}><body>' +
        '<:define tag="my-badge:span" ::n=${0}>' +
        '<i :if=${n + bump === 0}>none</i><i :else-if=${n + bump === 1}>one</i>' +
        '<i :else>lots</i>' +
        '</:define>' +
        '<my-badge ::n=${1} /><my-badge ::n=${5} /><my-badge />' +
        '</body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.runtime).toStrictEqual([]);
    expect(r.live()).toContain('<i>one</i>');
    expect(r.live()).toContain('<i>lots</i>');
    expect(r.live()).toContain('<i>none</i>');
    r.ctx!.root.proxy['bump'] = 1;
    expect(r.live().match(/<i>one<\/i>/g)).toHaveLength(1);
    expect(r.live().match(/<i>lots<\/i>/g)).toHaveLength(2);
    expect(r.live()).not.toContain('none');
  });

  it('works in slotted content', () => {
    // written at the call site, living inside the instance: the branches
    // move together, so they are still each other's siblings where it counts
    const r = run(
      '<html :n=${1}><body>' +
        '<:define tag="my-box:div"><:slot /></:define>' +
        '<my-box><i :if=${n === 1}>one</i><i :else>other</i></my-box>' +
        '</body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.live()).toContain('<i>one</i>');
    r.ctx!.root.proxy['n'] = 2;
    expect(r.live()).toContain('<i>other</i>');
    expect(r.live()).not.toContain('one');
  });

  it('gives each branch of a definition a slot of its own', () => {
    // what a component adapting its own shape looks like: two renderings of
    // the same tag, each taking different markup from the call site. Both
    // slots are filled at compile time and the branch that lost is parked
    // with its content inside it, so switching swaps the markup as well as
    // the wrapper.
    //
    // The bug this caught is worth stating: a usage that fills a slot gets a
    // stencil of its own, and every scope holding that slot is COPIED to go
    // with it. The copies missed the chain links -- so both branches were
    // lone `:if`s, and an `:else` (whose condition compiles to `true`) showed
    // whatever else was showing.
    const r = run(
      '<html :compact=${false}><body>' +
        '<:define tag="my-card:div">' +
        '<div class="full" :if=${!compact}><:slot name="full" /></div>' +
        '<div class="mini" :else><:slot name="mini" /></div>' +
        '</:define>' +
        '<my-card><b :slot="full">FULL</b><i :slot="mini">MINI</i></my-card>' +
        '</body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.runtime).toStrictEqual([]);
    expect(shown(r)).toStrictEqual(['div', 'div.full', 'b']);
    r.ctx!.root.proxy['compact'] = true;
    expect(shown(r)).toStrictEqual(['div', 'div.mini', 'i']);
  });

  it('keeps two chains in one parent apart', () => {
    const r = run(
      '<html :a=${true} :b=${false}><body>' +
        '<i :if=${a}>A</i><i :else>notA</i>' +
        '<u :if=${b}>B</u><u :else>notB</u>' +
        '</body></html>'
    );
    expect(r.live()).toContain('<i>A</i>');
    expect(r.live()).toContain('<u>notB</u>');
    r.ctx!.root.proxy['b'] = true;
    expect(r.live()).toContain('<i>A</i>');
    expect(r.live()).toContain('<u>B</u>');
  });

  it('takes a custom tag as a branch', () => {
    // a usage is compiled into an instance built where the usage sat, which
    // is a different scope from the one the loader gave it -- so the link
    // has to be re-pointed at the instance or it names nothing
    const r = run(
      '<html :n=${1}><body>' +
        '<:define tag="my-box:div" ::label="box">${label}</:define>' +
        '<my-box :if=${n === 1} ::label=${"first"} />' +
        '<p :else>other</p>' +
        '</body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.live()).toContain('first');
    r.ctx!.root.proxy['n'] = 2;
    expect(r.live()).toContain('<p>other</p>');
    expect(r.live()).not.toContain('first');
  });

  it('costs a lone :if nothing', () => {
    // no chain, no links emitted -- which is what lets the runtime tell the
    // ordinary case from a chain without looking at its siblings
    const r = run('<html><body><p :if=${true}>x</p></body></html>');
    expect(r.errors).toStrictEqual([]);
    expect(page7(r)).not.toMatch(/elseOf|elseNext/);
  });

  // ---------------------------------------------------------------------
  // what it refuses
  // ---------------------------------------------------------------------

  it('needs a branch immediately before it', () => {
    expect(run('<html><body><p :else>x</p></body></html>').errors.join())
      .toMatch(/":else" needs an ":if" or ":else-if" on the element immediately before it/);
    expect(run('<html><body><p :if=${1}>a</p><b>b</b><p :else>x</p></body></html>').errors.join())
      .toMatch(/needs an ":if" or ":else-if"/);
    expect(run('<html><body><p :else-if=${1}>x</p></body></html>').errors.join())
      .toMatch(/":else-if" needs an ":if" or ":else-if"/);
  });

  it('allows whitespace and comments between the branches, and nothing else', () => {
    const spaced = run(
      '<html :on=${false}><body>\n  <p :if=${on}>yes</p>\n  <!-- and otherwise -->\n' +
        '  <p :else>no</p>\n</body></html>'
    );
    expect(spaced.errors).toStrictEqual([]);
    expect(spaced.live()).toContain('<p>no</p>');
    expect(run('<html><body><p :if=${1}>a</p>text<p :else>x</p></body></html>').errors.join())
      .toMatch(/is separated from the ":if" or ":else-if" before it by content of its own/);
    expect(run('<html :v=${1}><body><p :if=${1}>a</p>${v}<p :else>x</p></body></html>').errors.join())
      .toMatch(/is separated from/);
  });

  it('ends the chain at :else', () => {
    expect(run('<html><body><p :if=${1}>a</p><p :else>x</p><p :else>y</p></body></html>').errors.join())
      .toMatch(/comes after an ":else", which already answers for every case/);
    expect(run('<html><body><p :if=${1}>a</p><p :else>x</p><p :else-if=${2}>y</p></body></html>').errors.join())
      .toMatch(/comes after an ":else"/);
  });

  it('refuses a condition on :else, and none on :else-if', () => {
    expect(run('<html><body><p :if=${1}>a</p><p :else=${2}>x</p></body></html>').errors.join())
      .toMatch(/":else" takes no condition/);
    expect(run('<html><body><p :if=${1}>a</p><p :else-if>x</p></body></html>').errors.join())
      .toMatch(/":else-if" needs a condition/);
  });

  it('refuses two branch spellings on one element', () => {
    expect(run('<html><body><p :if=${1} :else>x</p></body></html>').errors.join())
      .toMatch(/Cannot use ":else" with ":if" on the same element/);
    expect(run('<html><body><p :else-if=${1} :else>x</p></body></html>').errors.join())
      .toMatch(/Cannot use ":else" with ":else-if"/);
  });

  it('is refused alongside the other arities, and named as it was written', () => {
    // the compiler thinks in `if$`; the author wrote `:else-if`, and being
    // told about an `:if` they did not write is a puzzle rather than a report
    expect(
      run(
        '<html><body><p :if=${1}>a</p><p :else-if=${1} :for-each=${[1]}>x</p></body></html>'
      ).errors.join()
    ).toMatch(/Cannot use ":else-if" with ":for-each"/);
    expect(
      run('<html><body><p :if=${1}>a</p><p :else :for-data=${1}>x</p></body></html>').errors.join()
    ).toMatch(/Cannot use ":else" with ":for-data"/);
  });

  it('cannot go on <:logic>, which has nothing to show or hide', () => {
    expect(run('<html><body><p :if=${1}>a</p><:logic :else /></body></html>').errors.join())
      .toMatch(/<:logic> has no element, so ":else" has nothing to show or hide/);
  });

  it('cannot be declared as a value, which is why the names were free', () => {
    // `${else}` does not parse, and `else-if` is not a name a plain value
    // can take -- both were already errors before either meant anything
    expect(run('<html><body><p>${else}</p></body></html>').errors.length).toBeGreaterThan(0);
    expect(run('<html><body><p :else-if2=${1}>${x}</p></body></html>').errors.length)
      .toBeGreaterThan(0);
  });
});

/**
 * The elements actually in the document, as `tag.class`.
 *
 * A walk rather than a regex over the markup, because a branch that is away
 * is held by its scope and in no document at all -- so what these cases are
 * asking is exactly what the DOM has, and nothing about how it serializes.
 */
function shown(r: ReturnType<typeof run>): string[] {
  const out: string[] = [];
  const walk = (node: any) => {
    for (const child of node?.childNodes ?? []) {
      if (child.nodeType !== 1 || child.tagName === 'TEMPLATE') continue;
      if (child.tagName === 'SCRIPT') continue;
      const cls = child.getAttribute?.('class');
      out.push(cls ? `${child.tagName.toLowerCase()}.${cls}` : child.tagName.toLowerCase());
      walk(child);
    }
  };
  walk((r.doc as any)?.body);
  return out;
}

/** the generated props, for asserting on what the compiler did NOT emit */
function page7(r: ReturnType<typeof run>): string {
  return JSON.stringify(r.ctx?.root.props ?? {});
}
