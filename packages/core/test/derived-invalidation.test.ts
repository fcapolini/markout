import { describe, expect, it } from 'vitest';
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
 * When a derived value re-evaluates, and why "a cycle passed" is the wrong
 * question.
 *
 * `ctx.cycle` advances on every propagation anywhere on the page. A keyed
 * `:for-each` calls `set()` on each replica's alias as it reorders, so a
 * reorder of N rows advances it N times -- and a derived value read from
 * inside the loop used to re-evaluate on every one of them, however
 * unrelated it was to what moved.
 *
 * That is not merely wasted work when the derived builds a fresh object.
 * `${new Set(cart.map(l => l.id))}` -- the shape `useMemo` and `$derived`
 * both encourage, and the natural way to answer "is this row in the cart?"
 * -- returns a DIFFERENT Set each time, so each re-evaluation also counted
 * as a change and propagated back to all N rows. Reordering cost N x N.
 * On the catalog benchmark, sorting 10k rows took 59 seconds.
 *
 * The fix is `CoreValue.dirty`: a value re-evaluates when a source has
 * actually moved, not when a cycle has passed. These tests pin both halves
 * -- that an unrelated reorder leaves the derived alone, and that a real
 * change still reaches every row.
 */

const PAGE =
  '<html><body' +
  ' :cart=${["a"]}' +
  ' :ids=${new Set(cart)}' +
  ' :rows=${[{ id: "a" }, { id: "b" }, { id: "c" }]}' +
  ' :flipped=${false}' +
  ' :shown=${flipped ? [...rows].reverse() : rows}' +
  '><p :for-each=${shown} :for-key=${data.id}>${data.id}${ids.has(data.id) ? "*" : ""}</p>' +
  '</body></html>';

function render(html: string) {
  const page = new Page(parse(html, 'derived.html'));
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
  expect(errors).toStrictEqual([]);
  const rows = () => {
    const markup = page.source.doc.toString().replace(/<!--.*?-->/g, '');
    return [...markup.slice(markup.indexOf('<body')).matchAll(/<p[^>]*>([^<]*)<\/p>/g)].map(m => m[1]);
  };
  return { ctx, rows, errors, body: ctx.root.children[1] as any };
}

describe('a derived value read by every row', () => {
  it('is not re-derived when an unrelated reorder advances the cycle', () => {
    // the mechanism, pinned by identity: `ids` reads `cart`, and a reorder
    // moves neither. A fresh Set here means it re-derived, and a fresh Set
    // is what used to wake all N rows -- N times over
    const { body, rows, errors } = render(PAGE);
    expect(rows()).toStrictEqual(['a*', 'b', 'c']);
    const before = body.proxy.ids;

    body.proxy.flipped = true;

    expect(rows()).toStrictEqual(['c', 'b', 'a*']);
    expect(body.proxy.ids).toBe(before);
    expect(errors).toStrictEqual([]);
  });

  it('still re-derives, and still reaches every row, when its source moves', () => {
    // the other half: the optimisation must not buy its speed by going
    // quiet. `cart` moving has to produce a new Set AND reach every row
    const { body, rows } = render(PAGE);
    const before = body.proxy.ids;

    body.proxy.cart = ['b', 'c'];

    expect(body.proxy.ids).not.toBe(before);
    expect(rows()).toStrictEqual(['a', 'b*', 'c*']);
  });

  it('reaches every row when the source moves after a reorder', () => {
    // the two composed, in the order the benchmark meets them: sort, then
    // touch the cart. A reorder that left stale `dirty` state behind would
    // show up here and nowhere else
    const { body, rows } = render(PAGE);

    body.proxy.flipped = true;
    body.proxy.cart = ['c'];

    expect(rows()).toStrictEqual(['c*', 'b', 'a']);
  });
});
