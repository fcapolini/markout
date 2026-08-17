import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findDeclaration, identifierAt } from '../src/declarations';

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
async function declarationAt(rel: string, text: string, needle: string) {
  const found = text.indexOf(needle);
  expect(found, `"${needle}" is not in the fixture`).toBeGreaterThan(-1);
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
        '           :title=${\'Untitled\'}',
        '           :tone=${\'plain\'}>',
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
        '           :title=${\'Untitled\'}',
        '           :tone=${\'plain\'}>',
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
        '           :tone=${\'plain\'}',
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

  it('is not a property, and not a number', () => {
    expect(identifierAt('${data.name}', 9)).toBeUndefined();
    expect(identifierAt('${data.name}', 3)).toBe('data');
    expect(identifierAt('${42}', 3)).toBeUndefined();
  });
});
