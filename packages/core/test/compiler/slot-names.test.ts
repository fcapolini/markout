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
