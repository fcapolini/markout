import * as acorn from 'acorn';
import { generate } from 'escodegen';
import fs from 'fs';
import path from 'path';
import { assert, describe, it } from 'vitest';
import * as dom from '../../src/html/dom';
import * as parser from '../../src/html/parser';
import {
  ServerDocument,
  ServerElement,
  ServerNode,
  ServerTemplateElement,
} from '../../src/html/server-dom';
import { checkFixture, listFixtures } from '../test-utils';

const docroot = path.join(__dirname, 'parser');

describe('parser', () => {
  listFixtures(docroot).forEach(fixture => {
    it(fixture.title, async () => {
      const filePath = path.join(docroot, fixture.file);
      const text = await fs.promises.readFile(filePath);
      const source = parser.parse(text.toString(), fixture.file);
      checkFixture(
        fixture,
        source.errors.map(e => e.msg),
        () => source.doc!.toString() + '\n'
      );

      if (!source.errors.length) {
        // fixtures can additionally pin the parsed tree as `<name>-out.json`
        const pname2 = path.join(docroot, `${fixture.name}-out.json`);
        if (fs.existsSync(pname2)) {
          const expectedJSON = await fs.promises.readFile(pname2, {
            encoding: 'utf8',
          });
          const cleanup = (n: ServerNode) => {
            // both upward links, or JSON.stringify walks straight back up
            delete (n as any).parentElement;
            delete (n as any).parentNode;
            delete (n as any).ownerDocument;
            if (n.nodeType === dom.NodeType.DOCUMENT) {
              cleanup((n as ServerDocument).documentElement as ServerNode);
            } else if (n.nodeType === dom.NodeType.ELEMENT) {
              (n as ServerElement).attributes.forEach(a =>
                cleanup(a as any as ServerNode)
              );
              (n as ServerElement).childNodes.forEach(c =>
                cleanup(c as ServerNode)
              );
            } else if (n.nodeType === dom.NodeType.ATTRIBUTE) {
              if ((n as any).value && typeof (n as any).value === 'object') {
                (n as any).value = generate((n as any).value);
              }
            }
          };
          cleanup(source.doc);
          const actualJSON = JSON.stringify(source.doc, null, 2);
          const actual = JSON.parse(actualJSON);
          const expected = JSON.parse(expectedJSON);
          assert.deepEqual(actual, expected);
        }
      }
    });
  });
});

describe('attribute names', () => {
  function attrsOf(markup: string) {
    const source = parser.parse(markup, 'test');
    assert.deepEqual(
      source.errors.map(e => e.msg),
      []
    );
    const root = source.doc.documentElement as ServerElement;
    return { root, names: root.attributes.map(a => a.name) };
  }

  it('accepts $ for language attributes', () => {
    assert.deepEqual(attrsOf('<html :aka="page" :if="${x}"></html>').names, [
      ':aka',
      ':if',
    ]);
  });

  it('accepts * for wildcard bindings', () => {
    assert.deepEqual(attrsOf('<html :class-badge-*="${tone}"></html>').names, [
      ':class-badge-*',
    ]);
  });

  it('accepts dots', () => {
    assert.deepEqual(attrsOf('<html data-x.y="1"></html>').names, ['data-x.y']);
  });

  it('does not accept $ in attribute names', () => {
    // the tag ends at `$`, so what follows lexes as an attribute instead
    const source = parser.parse('<html $x></html>', 'test');
    assert.equal(source.doc.documentElement?.tagName, 'HTML');
    assert.deepEqual(
      source.errors.map(e => e.msg),
      ['Attribute names cannot start with "$" (use ":" prefix for directives like ":aka", ":if", ":foreach")']
    );
  });
});

describe('atomic text (<style>/<title>)', () => {
  function styleTextOf(markup: string) {
    const source = parser.parse(markup, 'test');
    assert.deepEqual(source.errors.map(e => e.msg), []);
    const style = (source.doc.documentElement as ServerElement).childNodes.find(
      n => (n as ServerElement).tagName === 'STYLE'
    ) as dom.Element;
    assert.equal(style.childNodes.length, 1);
    return style.childNodes[0] as dom.Text;
  }

  it('parses mixed literal/interpolated content as a single concatenated expression', () => {
    const text = styleTextOf(
      '<html><style>body{color:${light?"black":"white"};}.x{margin:${5}px;}</style></html>'
    );
    assert.equal(typeof text.textContent, 'object');
    const exp = text.textContent as acorn.Expression;
    // a single node, not one node per interpolation
    const js = generate(exp);
    const evaluate = (light: boolean) => new Function('light', `return ${js};`)(light);
    assert.equal(
      evaluate(true),
      'body{color:black;}.x{margin:5px;}'
    );
    assert.equal(
      evaluate(false),
      'body{color:white;}.x{margin:5px;}'
    );
  });

  it('parses purely static content as a plain string, not an expression', () => {
    const text = styleTextOf('<html><style>body{color:black;}</style></html>');
    assert.equal(typeof text.textContent, 'string');
    assert.equal(text.textContent, 'body{color:black;}');
  });

  it('parses a single interpolation with no surrounding literal text', () => {
    const text = styleTextOf('<html><style>${css}</style></html>');
    assert.equal(typeof text.textContent, 'object');
  });
});

describe('error handling', () => {
  it('collects syntax errors instead of throwing', () => {
    const source = parser.parse('<html>', 'test');
    assert.deepEqual(
      source.errors.map(e => e.msg),
      ['Expected </HTML>']
    );
  });

  it('propagates unexpected errors rather than reporting them as syntax errors', () => {
    // parsing aborts via an internal sentinel; a genuine bug must not be
    // swallowed and turned into a clean parse of a truncated document
    const src = new parser.Source('<html></html>', 'test');
    (src as unknown as { s: unknown }).s = null;
    assert.throws(() => parser.parse('', 'test', src), TypeError);
  });
});

it('linestarts (1)', () => {
  const s = new parser.Source('', 'test');
  assert.deepEqual(s.linestarts, [0]);
});

it('linestarts (2)', () => {
  const s = new parser.Source('foo\nbar', 'test');
  assert.deepEqual(s.linestarts, [0, 4]);
});

it('linestarts (3)', () => {
  const s = new parser.Source('foo\nbar\n', 'test');
  assert.deepEqual(s.linestarts, [0, 4]);
});

it('linestarts (4)', () => {
  const s = new parser.Source('foo\n\nbar\n', 'test');
  assert.deepEqual(s.linestarts, [0, 4, 5]);
});

it('pos() (1)', () => {
  const s = new parser.Source('', 'test');
  assert.equal(s.lineCount, 1);
  assert.deepEqual(s.pos(0), { line: 1, column: 0 });
  assert.deepEqual(s.pos(1), { line: 1, column: 1 });
  assert.deepEqual(s.pos(100), { line: 1, column: 100 });
});

it('pos() (2)', () => {
  const s = new parser.Source('foo\nbar', 'test');
  assert.equal(s.lineCount, 2);
  assert.deepEqual(s.pos(0), { line: 1, column: 0 });
  assert.deepEqual(s.pos(1), { line: 1, column: 1 });
  assert.deepEqual(s.pos(2), { line: 1, column: 2 });
  assert.deepEqual(s.pos(3), { line: 1, column: 3 });
  assert.deepEqual(s.pos(4), { line: 2, column: 0 });
  assert.deepEqual(s.pos(5), { line: 2, column: 1 });
  assert.deepEqual(s.pos(6), { line: 2, column: 2 });
  assert.deepEqual(s.pos(7), { line: 2, column: 3 });
  assert.deepEqual(s.pos(8), { line: 2, column: 4 });
});

it('pos() (3)', () => {
  const s = new parser.Source('foo\nbar\n', 'test');
  assert.equal(s.lineCount, 2);
  assert.deepEqual(s.pos(0), { line: 1, column: 0 });
  assert.deepEqual(s.pos(1), { line: 1, column: 1 });
  assert.deepEqual(s.pos(2), { line: 1, column: 2 });
  assert.deepEqual(s.pos(3), { line: 1, column: 3 });
  assert.deepEqual(s.pos(4), { line: 2, column: 0 });
  assert.deepEqual(s.pos(5), { line: 2, column: 1 });
  assert.deepEqual(s.pos(6), { line: 2, column: 2 });
  assert.deepEqual(s.pos(7), { line: 2, column: 3 });
  assert.deepEqual(s.pos(8), { line: 2, column: 4 });
});

it('pos() (4)', () => {
  const s = new parser.Source('foo\n\nbar\n', 'test');
  assert.equal(s.lineCount, 3);
  assert.deepEqual(s.pos(0), { line: 1, column: 0 });
  assert.deepEqual(s.pos(1), { line: 1, column: 1 });
  assert.deepEqual(s.pos(2), { line: 1, column: 2 });
  assert.deepEqual(s.pos(3), { line: 1, column: 3 });
  assert.deepEqual(s.pos(4), { line: 2, column: 0 });
  assert.deepEqual(s.pos(5), { line: 3, column: 0 });
  assert.deepEqual(s.pos(6), { line: 3, column: 1 });
  assert.deepEqual(s.pos(7), { line: 3, column: 2 });
  assert.deepEqual(s.pos(8), { line: 3, column: 3 });
  assert.deepEqual(s.pos(9), { line: 3, column: 4 });
  assert.deepEqual(s.pos(10), { line: 3, column: 5 });
});

it('loc() (1)', () => {
  const s = new parser.Source(
    /*  1 */ '<html :title="${\'sample\'}"\n' +
      /*  2 */ '      // attr comment\n' +
      /*  3 */ '      lang="en">\n' +
      /*  4 */ '  <head><style>\n' +
      /*  5 */ '    body {\n' +
      /*  6 */ '      color: ${"red"};\n' +
      /*  7 */ '    }\n' +
      /*  8 */ '  </style></head>\n' +
      /*  9 */ '  <body>\n' +
      /* 10 */ '    ${title}\n' +
      /* 11 */ '  </body>\n' +
      /* 12 */ '</html>\n',
    'inline'
  );
  const source = parser.parse(s.s, 'inline');
  const doc = source.doc;

  const root = doc.documentElement!;
  assert.equal(root.tagName, 'HTML');
  assert.deepEqual(root.loc, {
    source: 'inline',
    start: { line: 1, column: 0 },
    end: { line: 12, column: 7 },
    i1: 0,
    i2: 179,
  });

  {
    // root attributes
    const a1 = (root as ServerElement).attributes[0] as dom.Attribute;
    assert.equal(a1.name, ':title');
    assert.deepEqual(a1.loc, {
      source: 'inline',
      start: { line: 1, column: 6 },
      end: { line: 1, column: 26 },
      i1: 6,
      i2: 26,
    });
    assert.deepEqual(a1.valueLoc, {
      source: 'inline',
      start: { line: 1, column: 13 },
      end: { line: 1, column: 26 },
      i1: 13,
      i2: 26,
    });
    const exp1 = a1.value as acorn.Expression;
    assert.deepEqual(JSON.parse(JSON.stringify(exp1.loc)), {
      source: 'inline',
      start: { line: 1, column: 16 },
      end: { line: 1, column: 24 },
    });
    const a2 = (root as ServerElement).attributes[1] as dom.Attribute;
    assert.equal(a2.name, 'lang');
    assert.deepEqual(a2.loc, {
      source: 'inline',
      start: { line: 3, column: 6 },
      end: { line: 3, column: 15 },
      i1: 55,
      i2: 64,
    });
  }

  const rootText1 = root.childNodes[0]!;
  assert.equal(rootText1.nodeType, dom.NodeType.TEXT);
  assert.deepEqual(rootText1.loc, {
    source: 'inline',
    start: { line: 3, column: 16 },
    end: { line: 4, column: 2 },
    i1: 65,
    i2: 68,
  });

  const head = root.childNodes[1] as dom.Element;
  assert.equal(head.tagName, 'HEAD');
  assert.deepEqual(head.loc, {
    source: 'inline',
    start: { line: 4, column: 2 },
    end: { line: 8, column: 17 },
    i1: 68,
    i2: 139,
  });

  {
    // head content
    const style = head.childNodes[0] as dom.Element;
    assert.equal(style.tagName, 'STYLE');
    assert.deepEqual(style.loc, {
      source: 'inline',
      start: { line: 4, column: 8 },
      end: { line: 8, column: 10 },
      i1: 74,
      i2: 132,
    });
    // style text is atomic
    assert.equal(style.childNodes.length, 1);
    const styleText = style.childNodes[0] as dom.Text;
    assert.equal(styleText.nodeType, dom.NodeType.TEXT);
    assert.equal(typeof styleText.textContent, 'object');
    assert.deepEqual(styleText.loc, {
      source: 'inline',
      start: { line: 4, column: 15 },
      end: { line: 8, column: 2 },
      i1: 81,
      i2: 124,
    });
  }

  const rootText2 = root.childNodes[2]!;
  assert.equal(rootText2.nodeType, dom.NodeType.TEXT);
  assert.deepEqual(rootText2.loc, {
    source: 'inline',
    start: { line: 8, column: 17 },
    end: { line: 9, column: 2 },
    i1: 139,
    i2: 142,
  });

  const body = root.childNodes[3] as dom.Element;
  assert.equal(body.tagName, 'BODY');
  assert.deepEqual(body.loc, {
    source: 'inline',
    start: { line: 9, column: 2 },
    end: { line: 11, column: 9 },
    i1: 142,
    i2: 171,
  });

  {
    // body text
    const bodyText1 = body.childNodes[0] as dom.Text;
    assert.equal(bodyText1.nodeType, dom.NodeType.TEXT);
    assert.equal(typeof bodyText1.textContent, 'string');
    assert.deepEqual(bodyText1.loc, {
      source: 'inline',
      start: { line: 9, column: 8 },
      end: { line: 10, column: 4 },
      i1: 148,
      i2: 153,
    });

    const bodyText2 = body.childNodes[1] as dom.Text;
    assert.equal(bodyText2.nodeType, dom.NodeType.TEXT);
    assert.equal(typeof bodyText2.textContent, 'object');
    assert.deepEqual(bodyText2.loc, {
      source: 'inline',
      start: { line: 10, column: 4 },
      end: { line: 10, column: 12 },
      i1: 153,
      i2: 161,
    });

    const bodyText3 = body.childNodes[2] as dom.Text;
    assert.equal(bodyText3.nodeType, dom.NodeType.TEXT);
    assert.deepEqual(bodyText3.loc, {
      source: 'inline',
      start: { line: 10, column: 12 },
      end: { line: 11, column: 2 },
      i1: 161,
      i2: 164,
    });
  }

  const rootText3 = root.childNodes[4]!;
  assert.equal(rootText3.nodeType, dom.NodeType.TEXT);
  assert.deepEqual(rootText3.loc, {
    source: 'inline',
    start: { line: 11, column: 9 },
    end: { line: 12, column: 0 },
    i1: 171,
    i2: 172,
  });
});

it('should parse template tags', () => {
  const s = parser.parse(
    '<template>content</template>',
    'test',
    undefined,
    false
  );
  const root = s.doc.documentElement;
  assert.instanceOf(root, ServerTemplateElement);
});

// acorn drops parentheses by default, reporting the INNER expression's end.
// That left the caller looking at `)` where it expected `}`, so a
// parenthesized attribute expression failed to parse and a parenthesized
// text one spilled the leftover `)}` into the page as literal text.
describe('parser: parenthesized expressions', () => {
  function evaluate(exp: acorn.Expression): any {
    return new Function(`return (${generate(exp)});`)();
  }

  function findByTag(node: any, tag: string): dom.Element | undefined {
    for (const n of node.childNodes ?? []) {
      if ((n as ServerElement).tagName === tag) return n as dom.Element;
      const found = findByTag(n, tag);
      if (found) return found;
    }
    return undefined;
  }

  function onlyChild(html: string, tag: string): dom.Text {
    const source = parser.parse(html, 'test');
    assert.deepEqual(source.errors.map(e => e.msg), []);
    const el = findByTag(source.doc.documentElement, tag)!;
    // exactly one child: the expression. A stray `)}` would show up as an
    // extra literal text node right after it
    assert.equal(el.childNodes.length, 1);
    return el.childNodes[0] as dom.Text;
  }

  it('parses a parenthesized text interpolation without leaking the closer', () => {
    const text = onlyChild('<html><body><p>${(1 + 2)}</p></body></html>', 'P');
    assert.equal(evaluate(text.textContent as acorn.Expression), 3);
  });

  it('parses a parenthesized interpolation in atomic text', () => {
    const text = onlyChild('<html><style>${("a" + "b")}</style></html>', 'STYLE');
    assert.equal(evaluate(text.textContent as acorn.Expression), 'ab');
  });

  it('parses a parenthesized unquoted attribute expression', () => {
    const source = parser.parse('<html :a=${(1 + 2)}></html>', 'test');
    assert.deepEqual(source.errors.map(e => e.msg), []);
    const a = source.doc.documentElement!.getAttributeNode(':a')!;
    assert.equal(evaluate(a.value as acorn.Expression), 3);
  });

  it('parses a parenthesized object literal, the form that reads most naturally', () => {
    const source = parser.parse('<html :a=${({b: 1})}></html>', 'test');
    assert.deepEqual(source.errors.map(e => e.msg), []);
    const a = source.doc.documentElement!.getAttributeNode(':a')!;
    assert.deepEqual(evaluate(a.value as acorn.Expression), { b: 1 });
  });

  it('handles nested and repeated parentheses', () => {
    const text = onlyChild('<html><body><p>${((1) + ((2)))}</p></body></html>', 'P');
    assert.equal(evaluate(text.textContent as acorn.Expression), 3);
  });

  it('leaves no ParenthesizedExpression nodes in the tree', () => {
    const text = onlyChild('<html><body><p>${((1) + (2))}</p></body></html>', 'P');
    const json = JSON.stringify(text.textContent);
    // it isn't ESTree: estraverse has no visitor keys for it and escodegen
    // couldn't print it, so the wrappers must be gone by now
    assert.notInclude(json, 'ParenthesizedExpression');
  });

  it('reports an unterminated text expression instead of walking past it', () => {
    const source = parser.parse('<html><body><p>${1 + 2)}</p></body></html>', 'test');
    assert.include(source.errors.map(e => e.msg), 'Unterminated expression');
  });

  it('reports an unterminated atomic-text expression', () => {
    const source = parser.parse('<html><style>${1 + 2)}</style></html>', 'test');
    assert.include(source.errors.map(e => e.msg), 'Unterminated expression');
  });
});

describe("an attribute's own quote inside its expression -- issue #30", () => {
  // HTML ends an attribute at the first matching quote, and that is HTML's
  // rule -- but `${...}` already suppresses the other delimiter. `>` inside
  // an expression does not end the tag, so the quote was the one place a
  // delimiter stayed live inside an expression, and the result was a
  // `SyntaxError` pointing INSIDE the expression, at nothing the author had
  // got wrong.
  function find(node: any, tag: string): ServerElement | undefined {
    for (const n of node.childNodes ?? []) {
      if ((n as ServerElement).tagName === tag) return n as ServerElement;
      const found = find(n, tag);
      if (found) return found;
    }
    return undefined;
  }

  /** the `:v` expression of the page's only `<p>`, printed back as source */
  function attr(html: string): string {
    const src = parser.parse(html, 'test');
    assert.deepEqual(src.errors.map(e => e.msg), [], html);
    const p = find(src.doc.documentElement, 'P')!;
    // whitespace-collapsed: escodegen's line breaking is not what is under
    // test here, only where the value was decided to END
    return generate(p.getAttributeNode(':v')!.value as acorn.Expression)
      .replace(/\s+/g, ' ');
  }

  it('accepts a double quote inside a double-quoted attribute', () => {
    assert.equal(attr('<html><body><p :v="${"x"}">t</p></body></html>'), "'x'");
  });

  it('accepts a single quote inside a single-quoted attribute', () => {
    assert.equal(attr("<html><body><p :v='${'x'}'>t</p></body></html>"), "'x'");
  });

  it('finds the end past braces, strings and nested templates', () => {
    // the shapes that rule out every cheap "is this offset inside an
    // expression" test short of parsing: a brace in an object literal, a
    // brace inside a string, and a template with a hole of its own
    assert.equal(
      attr('<html><body><p :v="${["a","b"].join("-")}">t</p></body></html>'),
      "[ 'a', 'b' ].join('-')"
    );
    assert.equal(attr('<html><body><p :v="${{a: "}"}.a}">t</p></body></html>'), "{ a: \'}\' }.a");
    assert.equal(attr('<html><body><p :v="${`a${"b"}c`}">t</p></body></html>'), "`a${ \'b\' }c`");
  });

  it('still ends a plain literal at its quote', () => {
    const src = parser.parse('<html><body><p class="a b">t</p></body></html>', 'test');
    assert.deepEqual(src.errors.map(e => e.msg), []);
    assert.equal(find(src.doc.documentElement, 'P')!.getAttribute('class'), 'a b');
  });

  it('still reports an unterminated value rather than running to the end', () => {
    const src = parser.parse("<html><body><p :v=\"${'x'}>t</p></body></html>", 'test');
    assert.include(src.errors.map(e => e.msg), 'Unterminated attribute value');
  });

  it('leaves a broken expression to the parser that can explain it', () => {
    // acorn cannot read it, so this is not a quote to skip over: answer what
    // the old scan would have, and let the expression parse report it
    const src = parser.parse('<html><body><p :v="${1 +}">t</p></body></html>', 'test');
    assert.isNotEmpty(src.errors);
  });

  // ---------------------------------------------------------------------
  // the node the scan cached is the node the parse would have made
  // ---------------------------------------------------------------------
  //
  // Finding where the value ends means parsing the expressions in it, so
  // those are kept and handed to the parse that follows instead of being
  // thrown away and made again. That is a second producer of the same nodes,
  // and the failure it can have is silent: a cached node missing `locations`
  // or its `sourceFile`, or still wrapped in the parens acorn was asked to
  // preserve, compiles perfectly well and goes wrong somewhere else -- a
  // runtime error naming no file, an expression whose `}` is not found.
  // Every quoted attribute expression now comes from the cache, so these
  // check it against the paths that do not use one.

  function expOf(html: string, attribute: string): acorn.Expression {
    const src = parser.parse(html, 'quotes.html');
    assert.deepEqual(src.errors.map(e => e.msg), [], html);
    return find(src.doc.documentElement, 'P')!.getAttributeNode(attribute)!
      .value as acorn.Expression;
  }

  it('carries the locations a runtime error is named from', () => {
    // read by stage7 to build the `scopeId.key -> file:line:column` map, so
    // a cached node without them costs every runtime error its location and
    // says nothing about why
    const exp = expOf('<html><body><p :v="${ 1 + 2 }">t</p></body></html>', ':v');
    assert.equal(exp.loc?.source, 'quotes.html');
    assert.equal(exp.loc?.start.line, 1);
    assert.isNumber(exp.loc?.start.column);
  });

  it('agrees with the unquoted path, which uses no cache', () => {
    // `:v=${...}` never goes through the value scan, so it is the control
    const cached = expOf('<html><body><p :v="${a.b + 1}">t</p></body></html>', ':v');
    const direct = expOf('<html><body><p :v=${a.b + 1}>t</p></body></html>', ':v');
    assert.equal(generate(cached), generate(direct));
    assert.equal(cached.type, direct.type);
    assert.equal(cached.loc?.source, direct.loc?.source);
  });

  it('unwraps parens, and still finds the closing brace past them', () => {
    // the acorn subtlety `preserveParens` exists for: without the wrapper
    // acorn reports the INNER end and the scan looks for `}` at `)`. The
    // wrapper has to be there to find the end and gone from what is cached
    const exp = expOf('<html><body><p :v="${((1) + (2))}">t</p></body></html>', ':v');
    assert.notInclude(JSON.stringify(exp), 'ParenthesizedExpression');
    assert.equal(generate(exp).replace(/\s+/g, ' '), '1 + 2');
  });

  it('keeps several expressions in one value apart', () => {
    // each is cached under its own offset; one shared entry would give the
    // second the first's node, which renders wrongly and reports nothing
    const src = parser.parse(
      '<html><body><p :v="a${1}b${"x"}c">t</p></body></html>',
      'quotes.html'
    );
    assert.deepEqual(src.errors.map(e => e.msg), []);
    const exp = find(src.doc.documentElement, 'P')!.getAttributeNode(':v')!
      .value as acorn.Expression;
    // an interpolation is a template literal, so each expression is in a
    // hole of its own: one shared cache entry would put the first in both
    assert.equal(generate(exp).replace(/\s+/g, ' '), "`a${ 1 }b${ 'x' }c`");
  });

  // Not tested: that each expression is parsed exactly ONCE. It has no
  // correctness signature -- a cache that never hits produces identical
  // nodes, only slower -- so the only honest check is a measurement, and
  // that one is recorded against `valueEnd`: 37.8ms -> 39.0ms to compile
  // this repository's homepage, where parsing every interpolated attribute
  // twice instead cost +3.8ms. What the tests above pin is the part that
  // CAN go silently wrong: that what the cache hands over is what the parse
  // would have made.
});
