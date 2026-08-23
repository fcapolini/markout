import { beforeEach, describe, expect, it } from 'vitest';
import { Page } from '../src/compiler/ir/Page';
import { stage1load } from '../src/compiler/stages/stage1-load';
import { stage2validate } from '../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../src/compiler/stages/stage7-generate';
import { parse } from '../src/html/parser';
import { WebContext } from '../src/runtime/web/web-context';
import { loadProps } from '../src/render/props';

/**
 * The ways a reactive system goes wrong, each written as the page that
 * provokes it.
 *
 * These are not tests of a feature. They are the failure modes the design
 * has to keep answering for -- glitches, stranded readers, cascades that
 * stop early or never stop -- and most of them are silent when they happen:
 * a value is not stale, it is WRONG, for one cycle, with nothing thrown and
 * nothing logged. That is what makes them worth pinning rather than
 * rediscovering.
 *
 * Several are also the exact shapes a well-meaning optimisation breaks.
 * `dirty` (see CoreValue) is one such optimisation, and the reason this
 * file exists: cutting re-evaluation down to "a source actually moved"
 * saves the N x N reorder, and would be worth nothing if it stranded a
 * reader anywhere in here.
 */

/** how many times each counted expression has evaluated */
declare const globalThis: any;

function render(html: string) {
  globalThis.__evals = {};
  const page = new Page(parse(html, 'pitfalls.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  stage7generate(page);
  expect(page.errors.map(e => e.msg)).toStrictEqual([]);
  const errors: string[] = [];
  const ctx = new WebContext({
    ...loadProps(page.props!),
    doc: page.source.doc,
    onError: e => errors.push(`${e.phase}/${e.key}: ${e.message}`),
  }).refresh();
  const body = () => {
    const markup = page.source.doc.toString().replace(/<!--.*?-->/g, '');
    return markup.slice(markup.indexOf('<body'), markup.indexOf('<script'));
  };
  const texts = (tag: string) =>
    [...body().matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'g'))].map(m => m[1]);
  const evals = (key: string) => globalThis.__evals[key] ?? 0;
  // values declared on <body> live on its scope; the few pages here that
  // declare on <html> reach the root one
  return {
    ctx, body, texts, evals, errors,
    state: (ctx.root.children[1] as any).proxy,
    root: ctx.root.proxy as any,
  };
}

/** wraps an expression so the test can count how often it runs */
const counted = (key: string, expr: string) =>
  `(globalThis.__evals.${key} = (globalThis.__evals.${key} || 0) + 1, ${expr})`;

describe('the diamond', () => {
  it('evaluates the join once, with both arms settled', () => {
    // `n` reaches `sum` down two arms of different lengths. Evaluated when
    // the short arm lands, `sum` would compute against a `double` still
    // holding its previous value -- not stale, WRONG, and only for the one
    // cycle in which it changed
    const p = render(
      '<html><body :n=${1} :double=${n * 2} ' +
        ':sum=${' + counted('sum', 'n + double') + '}><p>${sum}</p></body></html>'
    );
    expect(p.texts('p')).toStrictEqual(['3']);
    const before = p.evals('sum');

    p.state.n = 2;

    expect(p.texts('p')).toStrictEqual(['6']);
    expect(p.evals('sum') - before).toBe(1);
    expect(p.errors).toStrictEqual([]);
  });
});

describe('a cascade that should stop', () => {
  it('does not re-run a reader when the value it reads lands the same', () => {
    // `n` moves, `positive` recomputes to the same boolean, and `label` has
    // no reason to run. A system that propagates "something upstream
    // changed" rather than "this changed" re-runs the whole tail
    const p = render(
      '<html><body :n=${1} :positive=${n > 0} ' +
        ':label=${' + counted('label', "positive ? 'yes' : 'no'") + '}><p>${label}</p></body></html>'
    );
    const before = p.evals('label');

    p.state.n = 5;

    expect(p.texts('p')).toStrictEqual(['yes']);
    expect(p.evals('label') - before).toBe(0);
  });

  it('still runs it when the value it reads really does change', () => {
    // the same cutoff, from the other side: stopping early must not be
    // achieved by stopping always
    const p = render(
      '<html><body :n=${1} :positive=${n > 0} ' +
        ':label=${' + counted('label', "positive ? 'yes' : 'no'") + '}><p>${label}</p></body></html>'
    );

    p.state.n = -1;

    expect(p.texts('p')).toStrictEqual(['no']);
  });
});

describe('a value written but not moved', () => {
  it('does not wake its readers when set to what it already held', () => {
    const p = render(
      '<html><body :n=${1} :out=${' + counted('out', 'n + 1') + '}><p>${out}</p></body></html>'
    );
    const before = p.evals('out');

    p.state.n = 1;

    expect(p.evals('out') - before).toBe(0);
    expect(p.texts('p')).toStrictEqual(['2']);
  });
});

describe('a branch nothing is reading', () => {
  it('does not change the result, and is current when it is chosen', () => {
    // dependencies here are static -- `pick` reads `a` and `b` whichever
    // way `flag` falls -- so the risk is the mirror of a dynamic system's:
    // not a missed edge, but a stale one. `b` moved while unread, and the
    // switch has to show what it moved TO
    const p = render(
      '<html><body :flag=${true} :a=${"A"} :b=${"B"} ' +
        ':pick=${flag ? a : b}><p>${pick}</p></body></html>'
    );
    expect(p.texts('p')).toStrictEqual(['A']);

    p.state.b = 'B2';
    expect(p.texts('p')).toStrictEqual(['A']);

    p.state.flag = false;
    expect(p.texts('p')).toStrictEqual(['B2']);
  });
});

describe('a derived that builds a new object every time', () => {
  it('propagates on identity, not on contents', () => {
    // deliberately NOT deep equality: `${new Set(...)}` holding the same
    // members is still a different object, and a page that stores it, or
    // hands it to something that keys off identity, has to see the new one.
    // A "clever" structural comparison here would go quiet
    const p = render(
      '<html><body :src=${[1]} :ids=${new Set(src)} ' +
        ':size=${' + counted('size', 'ids.size') + '}><p>${size}</p></body></html>'
    );
    const before = p.state.ids;

    p.state.src = [1];

    expect(p.state.ids).not.toBe(before);
    expect(p.texts('p')).toStrictEqual(['1']);
  });

  it('is built once for a page of rows, not once per row', () => {
    // Each new replica is refreshed as it is created, and a refresh opens a
    // cycle. A derived read from inside the loop that re-evaluated on every
    // PASSING cycle -- rather than when something it reads moved -- was
    // therefore rebuilt once per row. Building a fresh object each time, it
    // also counted as changed each time, and woke every row already built:
    // the N x N that took the catalog benchmark 59 seconds.
    //
    // The count is the whole assertion. Nothing about the rendered page
    // says which of these happened
    const rows = Array.from({ length: 40 }, (_, i) => `{ id: "r${i}" }`).join(', ');
    const p = render(
      '<html><body :cart=${["r1"]} :ids=${' + counted('ids', 'new Set(cart)') + '} ' +
        ':rows=${[' + rows + ']}>' +
        '<p :for-each=${rows} :for-key=${data.id}>${data.id}${ids.has(data.id) ? "*" : ""}</p>' +
        '</body></html>'
    );
    expect(p.texts('p').filter(t => t.endsWith('*'))).toStrictEqual(['r1*']);
    expect(p.evals('ids')).toBe(1);
  });

  it('is not rebuilt when a keyed reorder advances the cycle', () => {
    // the N x N case, in miniature: reordering calls set() on each
    // replica's alias, and each of those opens a cycle. A derived that
    // re-evaluated on every cycle would hand every row a new object, and
    // every row would recompute -- once per row, per row
    const p = render(
      '<html><body :cart=${["a"]} :ids=${' + counted('ids', 'new Set(cart)') + '} ' +
        ':rows=${[{ id: "a" }, { id: "b" }, { id: "c" }]} :flip=${false} ' +
        ':shown=${flip ? [...rows].reverse() : rows}>' +
        '<p :for-each=${shown} :for-key=${data.id}>${data.id}${ids.has(data.id) ? "*" : ""}</p>' +
        '</body></html>'
    );
    expect(p.texts('p')).toStrictEqual(['a*', 'b', 'c']);
    const before = p.evals('ids');

    p.state.flip = true;

    expect(p.texts('p')).toStrictEqual(['c', 'b', 'a*']);
    expect(p.evals('ids') - before).toBe(0);
  });
});

describe('a derived list feeding a keyed loop', () => {
  it('keeps its items\' identity when nothing it reads has moved', () => {
    // The chain that cost the catalog benchmark its sort, minimised.
    //
    // `items` builds fresh objects, so re-deriving it hands the loop a set
    // of items that are equal by key and different by identity. Keyed
    // reconciliation then matches each row to "its" item, assigns it, and
    // the assignment counts as a change -- at push level, so each one opens
    // another cycle, which invites the next re-derive. A reorder that
    // touches none of `items`' sources went round that loop once per row.
    //
    // The assertion is on identity, not on the rendered rows: every version
    // of this renders "a, b, c" correctly, and differs only in how much it
    // did to get there
    const p = render(
      '<html><body :seed=${[1, 2, 3]} ' +
        ':items=${' + counted('items', "seed.map(n => ({ id: 'i' + n }))") + '} ' +
        ':flip=${false} :shown=${flip ? [...items].reverse() : items}>' +
        '<p :for-each=${shown} :for-key=${data.id}>${data.id}</p></body></html>'
    );
    expect(p.texts('p')).toStrictEqual(['i1', 'i2', 'i3']);
    const before = p.evals('items');

    p.state.flip = true;

    expect(p.texts('p')).toStrictEqual(['i3', 'i2', 'i1']);
    expect(p.evals('items') - before).toBe(0);
  });

  it('does rebuild, and re-keys, when its own source moves', () => {
    const p = render(
      '<html><body :seed=${[1, 2]} ' +
        ':items=${seed.map(n => ({ id: "i" + n }))}>' +
        '<p :for-each=${items} :for-key=${data.id}>${data.id}</p></body></html>'
    );
    expect(p.texts('p')).toStrictEqual(['i1', 'i2']);

    p.state.seed = [3, 1];

    expect(p.texts('p')).toStrictEqual(['i3', 'i1']);
  });
});

describe('a row that arrives mid-cascade', () => {
  it('reads the page it arrived into, not the page as it was', () => {
    // a replica's values evaluate for the FIRST time inside someone else's
    // propagation. Nothing has marked them, because they did not exist to
    // be marked -- so "has anything I read moved?" is the wrong question
    // for them and they have to evaluate regardless
    const p = render(
      '<html><body :cart=${["b"]} :ids=${new Set(cart)} :rows=${[{ id: "a" }]}>' +
        '<p :for-each=${rows} :for-key=${data.id}>${data.id}${ids.has(data.id) ? "*" : ""}</p>' +
        '</body></html>'
    );
    expect(p.texts('p')).toStrictEqual(['a']);

    p.state.rows = [{ id: 'a' }, { id: 'b' }];

    // the new row is in the cart, and only knows that if it read `ids`
    expect(p.texts('p')).toStrictEqual(['a', 'b*']);
  });

  it('is reached by a later change like any other row', () => {
    const p = render(
      '<html><body :cart=${[]} :ids=${new Set(cart)} :rows=${[{ id: "a" }]}>' +
        '<p :for-each=${rows} :for-key=${data.id}>${data.id}${ids.has(data.id) ? "*" : ""}</p>' +
        '</body></html>'
    );
    p.state.rows = [{ id: 'a' }, { id: 'b' }];
    expect(p.texts('p')).toStrictEqual(['a', 'b']);

    p.state.cart = ['b'];

    expect(p.texts('p')).toStrictEqual(['a', 'b*']);
  });
});

describe('a region that comes and goes', () => {
  it('reconnects its readers when it returns', () => {
    // the edge into a region cannot exist while the region does not, so it
    // is dropped and remade. A reader left holding what it last saw is the
    // stale-and-silent failure `?.` exists to avoid
    const p = render(
      '<html :on=${true}><body>' +
        '<div :aka="panel" :if=${on}><span :aka="field" :text=${"A"}></span></div>' +
        '<i>${panel.field?.text}</i></body></html>'
    );
    expect(p.texts('i')).toStrictEqual(['A']);

    p.root.on = false;
    expect(p.texts('i')).toStrictEqual(['']);

    p.root.on = true;
    expect(p.texts('i')).toStrictEqual(['A']);
  });
});

describe('a chain of any depth', () => {
  it('carries a change all the way to the end', () => {
    const p = render(
      '<html><body :a=${1} :b=${a + 1} :c=${b + 1} :d=${c + 1} :e=${d + 1}>' +
        '<p>${e}</p></body></html>'
    );
    expect(p.texts('p')).toStrictEqual(['5']);

    p.state.a = 10;

    expect(p.texts('p')).toStrictEqual(['14']);
  });

  it('carries every step of a run of changes', () => {
    const p = render(
      '<html><body :a=${1} :b=${a * 2} :c=${b * 2}><p>${c}</p></body></html>'
    );
    const seen: string[] = [];
    for (const n of [2, 3, 4, 5]) {
      p.state.a = n;
      seen.push(p.texts('p')[0]);
    }
    expect(seen).toStrictEqual(['8', '12', '16', '20']);
  });
});
