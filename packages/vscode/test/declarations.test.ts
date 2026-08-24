import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chainAt, findDeclaration, identifierAt, tagNameAt } from '../src/declarations';

/**
 * Go-to-definition on a name in an expression.
 *
 * Every case here is one where searching the text for the name would give
 * the wrong answer or no answer: a parameter declared on the `<:define>` tag
 * and read in its body, the same name declared twice in different scopes,
 * and a name whose declaration is in another file. The compiler knows which
 * one is meant, and this asks it.
 */

let docroot: string;

beforeEach(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-decl-'));
});
afterEach(() => fs.rmSync(docroot, { recursive: true, force: true }));

function write(rel: string, text: string) {
  const full = path.join(docroot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return text;
}

/**
 * The declaration for the name at `needle`, with the cursor placed INSIDE
 * the identifier -- which is where a click lands, and not where `indexOf`
 * points when the needle starts with `${`.
 */
async function declarationAt(rel: string, text: string, needle: string, within?: string) {
  let found = text.indexOf(needle);
  expect(found, `"${needle}" is not in the fixture`).toBeGreaterThan(-1);
  // a needle can hold more than one name; `within` picks which of them the
  // cursor is on
  if (within) {
    found = text.indexOf(within, found);
  }
  // to the first LETTER, not the first identifier character: `$` is one of
  // those, so scanning for it stops on the `$` of `${` and puts the cursor
  // on the brace
  let offset = found;
  while (offset < text.length && !/[A-Za-z_]/.test(text[offset])) offset++;
  return findDeclaration({ docroot, pathname: `/${rel}`, text, offset: offset + 1 });
}

/** the line a declaration lands on, 1-based, the way an editor shows it */
const lineOf = (d: { range: { start: { line: number } } } | undefined) =>
  d ? d.range.start.line + 1 : undefined;

describe('a definition parameter, read in the definition body', () => {
  it('goes to the parameter, which is the case that was reported missing', async () => {
    const text = write(
      'lib.htm',
      [
        '<lib>',
        '  <:define tag="x-card:div"',
        '           ::title=${\'Untitled\'}',
        '           ::tone=${\'plain\'}>',
        '    <h2>${title}</h2>',
        '  </:define>',
        '</lib>',
      ].join('\n')
    );
    const found = await declarationAt('lib.htm', text, '${title}');
    expect(lineOf(found)).toBe(3);
    expect(found!.pathname).toBe('/lib.htm');
  });

  it('goes to the right one when a definition declares several', async () => {
    const text = write(
      'lib.htm',
      [
        '<lib>',
        '  <:define tag="x-card:div"',
        '           ::title=${\'Untitled\'}',
        '           ::tone=${\'plain\'}>',
        '    <h2>${title}</h2>',
        '    <p class=${tone}>x</p>',
        '  </:define>',
        '</lib>',
      ].join('\n')
    );
    expect(lineOf(await declarationAt('lib.htm', text, '${tone}'))).toBe(4);
  });

  it('works from another attribute of the definition itself', async () => {
    const text = write(
      'lib.htm',
      [
        '<lib>',
        '  <:define tag="x-card:div"',
        '           ::tone=${\'plain\'}',
        '           :class-warm=${tone === \'warm\'}>',
        '    <:slot />',
        '  </:define>',
        '</lib>',
      ].join('\n')
    );
    expect(lineOf(await declarationAt('lib.htm', text, 'tone ==='))).toBe(3);
  });
});

describe('the same name in two scopes', () => {
  it('goes to the one that is actually in scope', async () => {
    // the reason a text search cannot answer this: both declarations spell
    // the name identically and only one of them is what the cursor means
    const text = write(
      'index.html',
      [
        '<html :label=${\'outer\'}>',
        '  <body>',
        '    <div :label=${\'inner\'}>',
        '      <p>${label}</p>',
        '    </div>',
        '  </body>',
        '</html>',
      ].join('\n')
    );
    expect(lineOf(await declarationAt('index.html', text, '${label}'))).toBe(3);
  });

  it('walks outward when the nearer scope does not declare it', async () => {
    const text = write(
      'index.html',
      [
        '<html :label=${\'outer\'}>',
        '  <body>',
        '    <div :other=${1}>',
        '      <p>${label}</p>',
        '    </div>',
        '  </body>',
        '</html>',
      ].join('\n')
    );
    expect(lineOf(await declarationAt('index.html', text, '${label}'))).toBe(1);
  });
});

describe('a loop, where three different questions sit on one line', () => {
  const LOOP = [
    '<html>',
    '  <body :items=${[1, 2, 3]}>',
    '    <ul>',
    '      <li :for-each=${body.items} :for-as="item">${item}</li>',
    '    </ul>',
    '  </body>',
    '</html>',
  ].join('\n');

  it('goes from a scope name to the element that carries it', async () => {
    // `body` is not a value at all -- it is a named scope, and its
    // declaration site is the element. Nothing in `values` would answer this
    const text = write('index.html', LOOP);
    const found = await declarationAt('index.html', text, '${body.items}');
    expect(lineOf(found)).toBe(2);
    expect(found!.range.start.character).toBe(2);
  });

  it('goes from a name INSIDE that scope to its declaration', async () => {
    // `body.items` is a navigation followed by a lookup in there, not a
    // property access -- so `items` cannot be found by looking outward from
    // where the cursor is, which is why a text search gets this wrong
    const text = write('index.html', LOOP);
    const found = await declarationAt('index.html', text, 'body.items', 'items');
    expect(lineOf(found)).toBe(2);
    expect(text.split('\n')[1].slice(found!.range.start.character)).toMatch(/^:items=/);
  });

  it('goes from a loop alias to the :for-as that names it', async () => {
    // and to the ATTRIBUTE, not the element: the element's start is
    // imprecise and is usually the line the cursor is already on, so the
    // jump looks like nothing happening
    const text = write('index.html', LOOP);
    const found = await declarationAt('index.html', text, '${item}</li>');
    expect(lineOf(found)).toBe(4);
    expect(text.split('\n')[3].slice(found!.range.start.character)).toMatch(/^:for-as="item"/);
  });
});

describe('the scopes a document always has', () => {
  const PAGE = [
    "<html :title=${'T'}>",
    '  <head :meta=${1}>',
    '    <title>${page.title}</title>',
    '  </head>',
    '  <body :n=${2}>',
    '    <p>${head.meta} ${body.n}</p>',
    '  </body>',
    '</html>',
  ].join('\n');

  it('goes to <html>, <head> and <body> when the page writes them', async () => {
    const text = write('index.html', PAGE);
    expect(lineOf(await declarationAt('index.html', text, '${page.title}'))).toBe(1);
    expect(lineOf(await declarationAt('index.html', text, '${head.meta}'))).toBe(2);
    expect(lineOf(await declarationAt('index.html', text, '${body.n}'))).toBe(5);
  });

  it('answers even where the parser supplied the element', async () => {
    // a fragment has no <head> or <body> of its own -- they are synthesized,
    // with offsets into this file and no filename. Requiring a filename
    // meant `head` resolved to nothing in every fragment, which is where a
    // `<:define>` reading `head.x` actually lives
    const text = write(
      'lib.htm',
      ["<lib :light=${true}>", '  <:define tag="x-t:button"', '           :on-click=${() => head.light = !head.light}>t</:define>', '</lib>'].join('\n')
    );
    const found = await declarationAt('lib.htm', text, 'head.light');
    expect(lineOf(found)).toBe(1);
    expect(found!.pathname).toBe('/lib.htm');
  });
});

describe('a custom tag', () => {
  const LIB = [
    '<lib>',
    '  <:define tag="x-card:div"',
    "           ::title=${'Untitled'}>",
    '    <h2>${title}</h2>',
    '  </:define>',
    '</lib>',
  ].join('\n');

  it('goes to the <:define> that gives it meaning, in another file', async () => {
    // the one a reader of a page wants most: a tag they have never seen,
    // defined somewhere they would otherwise have to go looking for
    write('lib.htm', LIB);
    const text = write(
      'index.html',
      '<html>\n<head><:import src="/lib.htm" /></head>\n<body><x-card>hi</x-card></body>\n</html>'
    );
    const found = await declarationAt('index.html', text, '<x-card>');
    expect(found!.pathname).toBe('/lib.htm');
    expect(found!.selection.start.line).toBe(1);
  });

  it('goes there from the closing tag too', async () => {
    write('lib.htm', LIB);
    const text = write(
      'index.html',
      '<html>\n<head><:import src="/lib.htm" /></head>\n<body><x-card>hi</x-card></body>\n</html>'
    );
    const found = await declarationAt('index.html', text, '</x-card>');
    expect(found!.pathname).toBe('/lib.htm');
  });

  it('says nothing about an ordinary tag', async () => {
    const text = write('index.html', '<html :n=${1}>\n  <ul><li>${n}</li></ul>\n</html>');
    expect(await declarationAt('index.html', text, '<ul>')).toBeUndefined();
  });

  it('says nothing inside the <:define> that declares it', async () => {
    // `x-card` in `tag="x-card:div"` is the declaration; offering to
    // navigate from a thing to itself is noise
    const text = write('lib.htm', LIB);
    expect(await declarationAt('lib.htm', text, 'x-card:div')).toBeUndefined();
  });
});

describe("a custom tag's attributes", () => {
  const LIB = [
    '<lib>',
    '  <:define tag="x-card:div"',
    "           ::title=${'Untitled'}",
    "           ::tone=${'plain'}>${title}</:define>",
    '</lib>',
  ].join('\n');
  const PAGE = [
    '<html :n=${1}>',
    '<head><:import src="/lib.htm" /></head>',
    '<body>',
    "  <x-card ::title=${'Hi'} :aka=\"c\" class=\"wide\" />",
    '</body>',
    '</html>',
  ].join('\n');

  it('goes from the attribute to the parameter it sets', async () => {
    write('lib.htm', LIB);
    const text = write('index.html', PAGE);
    const found = await declarationAt('index.html', text, ':title=');
    expect(found!.pathname).toBe('/lib.htm');
    expect(found!.selection.start.line).toBe(2);
  });

  it('but from its VALUE to what the value reads, which is the other way', async () => {
    // a few characters apart and opposite directions: the name asks about
    // the definition, the expression about the call site
    write('lib.htm', LIB);
    const text = write(
      'index.html',
      PAGE.replace("${'Hi'}", '${n}')
    );
    const found = await declarationAt('index.html', text, ':title=${n}', 'n}');
    expect(found!.pathname).toBe('/index.html');
    expect(found!.selection.start.line).toBe(0);
  });

  it('says nothing for an attribute the definition does not declare', async () => {
    // `:aka` is the language's and `class` is HTML's; neither is a parameter
    write('lib.htm', LIB);
    const text = write('index.html', PAGE);
    expect(await declarationAt('index.html', text, ':aka=')).toBeUndefined();
    expect(await declarationAt('index.html', text, 'class="wide"')).toBeUndefined();
  });

  it('says nothing for an attribute of an ordinary tag', async () => {
    const text = write('index.html', '<html :n=${1}>\n  <p class="thing">${n}</p>\n</html>');
    expect(await declarationAt('index.html', text, 'class="thing"')).toBeUndefined();
  });
});

describe('an :aka on a custom tag', () => {
  it('goes to the usage, which has no element left to point at', async () => {
    // the instance was spliced out of the tree once its values had been
    // handed over, so the scope named `intro` has no element. What it keeps
    // is the values the usage WROTE, and the compiler says which those are
    write(
      'lib.htm',
      '<lib>\n  <:define tag="x-card:div" ::title=${\'d\'}>${title}</:define>\n</lib>'
    );
    const text = write(
      'index.html',
      [
        '<html>',
        '<head><:import src="/lib.htm" /></head>',
        '<body>',
        "  <x-card ::title=${'Hi'} :aka=\"intro\" />",
        '  <p>${intro.title}</p>',
        '</body>',
        '</html>',
      ].join('\n')
    );
    const found = await declarationAt('index.html', text, '${intro.title}');
    expect(found!.pathname).toBe('/index.html');
    // the usage on line 4, not the definition and not nothing
    expect(found!.selection.start.line).toBe(3);
  });

  it('reads a value of that instance as the usage wrote it', async () => {
    write(
      'lib.htm',
      '<lib>\n  <:define tag="x-card:div" ::title=${\'d\'}>${title}</:define>\n</lib>'
    );
    const text = write(
      'index.html',
      [
        '<html>',
        '<head><:import src="/lib.htm" /></head>',
        '<body>',
        "  <x-card ::title=${'Hi'} :aka=\"intro\" />",
        '  <p>${intro.title}</p>',
        '</body>',
        '</html>',
      ].join('\n')
    );
    // `intro.title` is the value on that instance, which the usage supplied
    const found = await declarationAt('index.html', text, 'intro.title', '.title');
    expect(found!.pathname).toBe('/index.html');
    expect(found!.selection.start.line).toBe(3);
  });
});

describe('the scope-navigation names', () => {
  const PAGE = [
    '<html :n=${1}>',
    '<body :m=${2}>',
    '  <p>${$parent.n} ${$host}</p>',
    '</body>',
    '</html>',
  ].join('\n');

  it('goes from $parent to the scope it names', async () => {
    const text = write('index.html', PAGE);
    // from <body>, one step out is <html>
    expect(lineOf(await declarationAt('index.html', text, '$parent.n'))).toBe(1);
  });

  it('goes through $parent to a name in there', async () => {
    const text = write('index.html', PAGE);
    expect(lineOf(await declarationAt('index.html', text, '$parent.n', 'n}'))).toBe(1);
  });

  it('says nothing for $host, which has no single answer', async () => {
    // whichever instance encloses this one is a property of each usage
    // rather than of the definition -- the compiler calls it dynamic, and
    // there is no one element to open
    const text = write('index.html', PAGE);
    expect(await declarationAt('index.html', text, '${$host}')).toBeUndefined();
  });
});

describe('where the cursor is actually put', () => {
  /**
   * The bug this exists to prevent, which cost a round of "still doesn't
   * work": a scope is declared by an ELEMENT, and an element's range is
   * everything inside it. Returning that as the selection asks the editor to
   * reveal a region the cursor is already in, and it does nothing -- which
   * is indistinguishable from a feature that is broken.
   *
   * `head` appeared to work throughout, for the only reason that a page's
   * <head> does not contain the <body> the click was in.
   */
  const PAGE = [
    "<html :title=${'T'}>",
    '  <head :charset=${1}>',
    '    <title>x</title>',
    '  </head>',
    '  <body :items=${[1]}>',
    '    <p>${page.title} ${body.items}</p>',
    '  </body>',
    '</html>',
  ].join('\n');

  it('is a point, not the extent of the element', async () => {
    const text = write('index.html', PAGE);
    const found = await declarationAt('index.html', text, '${body.items}');
    // the whole element, for a peek preview
    expect(found!.range.start.line).toBe(4);
    expect(found!.range.end.line).toBe(6);
    // and one point, for the jump
    expect(found!.selection).toStrictEqual({
      start: { line: 4, character: 2 },
      end: { line: 4, character: 2 },
    });
  });

  it('lands outside the line that was clicked, for every scope', async () => {
    const text = write('index.html', PAGE);
    for (const name of ['${page.title}', '${body.items}']) {
      const found = await declarationAt('index.html', text, name);
      // line 6 is where both are read; a selection that spanned the whole
      // element would still "contain" it and the editor would sit still
      expect(found!.selection.start.line).toBeLessThan(5);
      expect(found!.selection.start).toStrictEqual(found!.selection.end);
    }
  });
});

describe('what it declines to answer', () => {
  it('says nothing for a property of a value', async () => {
    // `data.name` -- `data` has a declaration, `name` is a property of
    // whatever it holds at runtime and has no declaration site in the page
    const text = write(
      'index.html',
      '<html :data=${({ name: 1 })}>\n  <p>${data.name}</p>\n</html>'
    );
    expect(await declarationAt('index.html', text, 'name}')).toBeUndefined();
  });

  it('says nothing for a chain that is not made of names', async () => {
    const text = write('index.html', '<html :rows=${[[1]]}>\n  <p>${rows[0].length}</p>\n</html>');
    expect(await declarationAt('index.html', text, 'length')).toBeUndefined();
  });

  it('says nothing for a name that is not declared', async () => {
    const text = write('index.html', '<html>\n  <p>${nope}</p>\n</html>');
    expect(await declarationAt('index.html', text, '${nope}')).toBeUndefined();
  });

  it('says nothing in ordinary markup', async () => {
    const text = write('index.html', '<html :n=${1}>\n  <p class="thing">x</p>\n</html>');
    expect(await declarationAt('index.html', text, 'thing')).toBeUndefined();
  });
});

describe('the identifier under the cursor', () => {
  it('is the whole name, from anywhere inside it', () => {
    expect(identifierAt('${title}', 2)).toBe('title');
    expect(identifierAt('${title}', 4)).toBe('title');
    expect(identifierAt('${title}', 7)).toBe('title');
  });

  it('is not a number', () => {
    expect(identifierAt('${42}', 3)).toBeUndefined();
    expect(identifierAt('${ }', 3)).toBeUndefined();
  });
});

describe('the tag name under the cursor', () => {
  it('is found on an opening and a closing tag', () => {
    expect(tagNameAt('<x-card />', 3)).toBe('x-card');
    expect(tagNameAt('</x-card>', 4)).toBe('x-card');
    expect(tagNameAt('<x-card>hi</x-card>', 2)).toBe('x-card');
  });

  it('is not found where a name merely looks like one', () => {
    // inside an attribute value, or in prose: neither is a tag
    expect(tagNameAt('<:define tag="x-card:div">', 16)).toBeUndefined();
    expect(tagNameAt('use the x-card tag', 10)).toBeUndefined();
  });
});

describe('the chain under the cursor', () => {
  // where the "is this a property or a scope?" question is ANSWERED is the
  // compiler; what is decided here is only what was asked
  it('is just the name when there is no chain', () => {
    expect(chainAt('${title}', 4)).toStrictEqual(['title']);
  });

  it('carries the segments before it, and none after', () => {
    expect(chainAt('${body.items}', 4)).toStrictEqual(['body']);
    expect(chainAt('${body.items}', 9)).toStrictEqual(['body', 'items']);
    expect(chainAt('${a.b.c}', 6)).toStrictEqual(['a', 'b', 'c']);
  });

  it('refuses a chain that is not made of names', () => {
    // `rows[0].length` -- a partial answer would point somewhere arbitrary
    expect(chainAt('${rows[0].length}', 12)).toBeUndefined();
  });
});
