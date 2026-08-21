import { describe, expect, it } from 'vitest';
import { Page } from '../../src/compiler/ir/Page';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { parse } from '../../src/html/parser';

/**
 * One name, one slot, per definition.
 *
 * A usage's content goes to one place, so only the first `<:slot>` of a name
 * can ever be filled -- a second renders whatever it holds itself and never
 * the caller's markup. That was resolved first-wins and said nothing, which
 * is the wrong half of a rule to keep quiet about: the markup the caller
 * wrote is simply absent, and nothing in the page says where it went.
 *
 * The case it actually bites is the one `:else` made possible. A component
 * that renders one of two shapes wants the caller's content in whichever is
 * showing, and writing `<:slot />` in both branches is the obvious way to
 * ask for that. It compiles, the first branch works, and switching to the
 * other empties the component.
 */
function errors(html: string): string[] {
  const page = new Page(parse(html, 'slots.html'));
  page.errors = page.source.errors;
  page.errors.length || stage1load(page);
  return page.errors.map(e => e.msg);
}

const USES = '<body><my-box>CONTENT</my-box></body>';

describe('a definition with two slots of one name', () => {
  it('refuses the pair an :if/:else chain invites', () => {
    const found = errors(
      '<html><head>' +
        '<:define tag="my-box:div">' +
        '<div :if=${true}><:slot /></div><div :else><:slot /></div>' +
        '</:define>' +
        `</head>${USES}</html>`
    );
    expect(found.join()).toMatch(/<my-box> has a second unnamed <:slot>/);
    // and says what to do instead, which is not guessable from the failure:
    // the content vanishing looks like a slot bug, not a naming decision
    expect(found.join()).toMatch(/a slot each, under names of their own/);
  });

  it('refuses a repeated NAME just the same', () => {
    expect(
      errors(
        '<html><head>' +
          '<:define tag="my-box:div">' +
          '<u><:slot name="s" /></u><i><:slot name="s" /></i>' +
          '</:define>' +
          `</head>${USES}</html>`
      ).join()
    ).toMatch(/<my-box> has a second <:slot name="s">/);
  });

  it('sees one that a replication stencil has moved out of sight', () => {
    // by this point `:for-each` has put its markup inside a <template>, and a
    // slot in there is still one of this definition's -- the same descent
    // findSlots makes, for the same reason
    expect(
      errors(
        '<html><head>' +
          '<:define tag="my-box:div">' +
          '<:slot />' +
          '<u :for-each=${[1]}><:slot /></u>' +
          '</:define>' +
          `</head>${USES}</html>`
      ).join()
    ).toMatch(/has a second unnamed <:slot>/);
  });

  it('allows a slot per branch under names of their own', () => {
    // the shape the error recommends, which is what makes a component able to
    // adapt: each branch takes its own markup from the call site
    expect(
      errors(
        '<html><head>' +
          '<:define tag="my-box:div">' +
          '<div :if=${true}><:slot name="wide" /></div>' +
          '<div :else><:slot name="narrow" /></div>' +
          '</:define>' +
          '</head><body><my-box>' +
          '<b :slot="wide">W</b><i :slot="narrow">N</i>' +
          '</my-box></body></html>'
      )
    ).toStrictEqual([]);
  });

  it('leaves one definition out of another definition\'s count', () => {
    expect(
      errors(
        '<html><head>' +
          '<:define tag="my-a:div"><:slot /></:define>' +
          '<:define tag="my-b:div"><:slot /></:define>' +
          '</head><body><my-a>x</my-a><my-b>y</my-b></body></html>'
      )
    ).toStrictEqual([]);
  });
});

/**
 * `<:slot>` at a usage site, which is the other half of slotting written in
 * the wrong half's spelling.
 *
 * The element DECLARES a slot and the `:slot` attribute ADDRESSES one, and
 * the two look enough alike that `<:slot name="end">` reads like it fills
 * `end`. It doesn't, and it used to say nothing: unwrapSlots() replaced the
 * element with what it held, and the content -- now carrying no address at
 * all -- went to the default slot. That is a real page's theme toggle
 * rendering inside a navbar's brand instead of at its right edge.
 */
describe('a <:slot> written outside a definition', () => {
  const DEF = '<:define tag="my-box:div"><:slot name="end" /></:define>';

  it('refuses one at a usage site, and says how to address a slot', () => {
    const found = errors(
      `<html><head>${DEF}</head>` +
        '<body><my-box><:slot name="end"><b>X</b></:slot></my-box></body></html>'
    ).join();
    expect(found).toMatch(/<:slot name="end"> inside <my-box> fills no slot/);
    // the fix, spelled on the caller's own tag rather than an invented one
    expect(found).toMatch(/<b :slot="end">/);
    // and what happens instead, since the markup does render -- just not
    // where it was aimed, which is the part that makes this hard to see
    expect(found).toMatch(/goes to <my-box>'s default slot/);
  });

  it('refuses one in plain page markup, where there is no caller at all', () => {
    const found = errors(
      `<html><head>${DEF}</head><body><div><:slot />x</div></body></html>`
    ).join();
    expect(found).toMatch(/<:slot> means nothing outside a <:define>/);
    expect(found).not.toMatch(/default slot/);
  });

  it('finds one nested below the usage site, not just directly under it', () => {
    expect(
      errors(
        `<html><head>${DEF}</head>` +
          '<body><my-box><div><:slot name="end">X</:slot></div></my-box></body></html>'
      ).join()
    ).toMatch(/inside <my-box>/);
  });

  it('leaves a definition\'s own slots alone, expanded usages included', () => {
    expect(
      errors(
        `<html><head>${DEF}</head>` +
          '<body><my-box><b :slot="end">X</b></my-box><my-box /></body></html>'
      )
    ).toStrictEqual([]);
  });

  it('says nothing extra about a definition that was refused for another reason', () => {
    // the <:define> stays in the tree when expandDefine gives up, slots and
    // all, and those slots are written correctly -- reporting them too would
    // bury the one error that explains the page
    const found = errors(
      '<html><head><:define tag="my-box:div" :aka="boxy"><:slot /></:define></head>' +
        '<body><my-box /></body></html>'
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/cannot carry ":aka"/);
  });
});
