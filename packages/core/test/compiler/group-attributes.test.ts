import { describe, expect, it } from 'vitest';
import { Page } from '../../src/compiler/ir/Page';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { parse } from '../../src/html/parser';

/**
 * `<:group>` carrying attributes.
 *
 * A passive group is a splice and belongs to the preprocessor. An active
 * one asks for something a group cannot be -- it has no element and no
 * scope -- so stage1 answers in one of three ways, and the rules are in
 * docs/design/group-regions.md:
 *
 * - a control attribute transfers onto the group's content where that
 *   content is a single element, since `<:group :if=${x}><p/></:group>` and
 *   `<p :if=${x}/>` are the same page written two ways;
 * - an element-only attribute (`class`, `:on-`) has nothing to apply to;
 * - a value or a name would need the group to be a scope, which is the
 *   region form and is not built.
 *
 * Whichever answer applied, the tag goes and the content stays. A directive
 * tag left standing serializes to nothing AND takes its children with it,
 * so a refusal that stopped early would delete the markup it was
 * complaining about -- which is the failure this whole area used to have.
 */
function compile(body: string) {
  const page = new Page(
    parse(`<html><body :ok=\${true} :rows=\${[1, 2]}>${body}</body></html>`, 'g.html')
  );
  page.errors = page.source.errors;
  page.errors.length || stage1load(page);
  return {
    errors: page.errors.map(e => e.msg),
    html: page.source.doc.toString().replace(/\s+/g, ' '),
  };
}

describe('a control attribute on a group holding one element', () => {
  it('gives it to that element, producing the page written the other way', () => {
    const viaGroup = compile('<:group :if=${ok}><p>one</p></:group>');
    const direct = compile('<p :if=${ok}>one</p>');
    expect(viaGroup.errors).toStrictEqual([]);
    expect(viaGroup.html).toBe(direct.html);
  });

  it('carries a whole family across, `:for-as` included', () => {
    const viaGroup = compile(
      '<:group :for-each=${rows} :for-as="r"><p>${r}</p></:group>'
    );
    const direct = compile('<p :for-each=${rows} :for-as="r">${r}</p>');
    expect(viaGroup.errors).toStrictEqual([]);
    expect(viaGroup.html).toBe(direct.html);
  });

  it('does not count the whitespace a pretty-printer left behind', () => {
    const found = compile('<:group :if=${ok}>\n  <p>one</p>\n</:group>');
    expect(found.errors).toStrictEqual([]);
    expect(found.html).toMatch(/data-markout-region/);
  });

  it('resolves the inner group first, so the outer one holds one element', () => {
    const nested = compile(
      '<:group :if=${ok}><:group :for-each=${rows} :for-as="r"><p>${r}</p></:group></:group>'
    );
    const direct = compile('<p :if=${ok} :for-each=${rows} :for-as="r">${r}</p>');
    expect(nested.errors).toStrictEqual([]);
    expect(nested.html).toBe(direct.html);
  });
});

describe('a branch on a group holding several nodes', () => {
  it.each([
    ['two elements', '<:group :if=${ok}><p>one</p><p>two</p></:group>'],
    ['an element and some text', '<:group :if=${ok}>hello<p>one</p></:group>'],
  ])('makes a region of %s', (_label, markup) => {
    const found = compile(markup);
    expect(found.errors).toStrictEqual([]);
    // a region, which at this stage means the stencil stage1 wraps it in.
    // What that region actually renders is group-regions.test.ts, since the
    // markers and the run between them are stage7's and the runtime's
    expect(found.html).toMatch(/data-markout-region/);
  });
});

describe('a control attribute with nowhere to land', () => {
  it('refuses an empty group, naming what it holds', () => {
    expect(compile('<:group :if=${ok}></:group>').errors.join()).toMatch(
      /holding nothing needs the group to be a region/
    );
  });

  it('refuses a loop over several nodes, which the clone path cannot do', () => {
    expect(
      compile('<:group :for-each=${rows} :for-as="r"><p>${r}</p><i>${r}</i></:group>')
        .errors.join()
    ).toMatch(/replicating several nodes at once is not built/);
  });

  it.each([
    ['the same attribute', '<:group :if=${ok}><p :if=${ok}>one</p></:group>'],
    ['the same family', '<:group :if=${ok}><p :else>one</p></:group>'],
  ])('refuses %s on the content: that is two regions', (_label, markup) => {
    expect(compile(markup).errors.join()).toMatch(/two regions, one within the other/);
  });
});

describe('what a group can never carry', () => {
  it.each(['class="x"', ':on-click=${() => 0}', ':class-a=${ok}', ':attr-hidden=${ok}'])(
    'refuses %s for having no element',
    attr => {
      const found = compile(`<:group ${attr}><p>one</p></:group>`);
      expect(found.errors.join()).toMatch(/has no element of its own/);
      expect(found.html).toMatch(/<p[^>]*>one<\/p>/);
    }
  );

  it.each([':n=${1}', ':aka="g"', ':did-init=${() => 0}'])(
    'refuses %s for having no scope',
    attr => {
      expect(compile(`<:group ${attr}><p>one</p></:group>`).errors.join()).toMatch(
        /has no scope of its own/
      );
    }
  );
});

describe('a passive group', () => {
  it('is still spliced away with its children in place', () => {
    const found = compile('<:group><p>one</p><p>two</p></:group>');
    expect(found.errors).toStrictEqual([]);
    expect(found.html).toMatch(/<p>one<\/p><p>two<\/p>/);
  });
});
