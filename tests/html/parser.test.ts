import * as acorn from 'acorn';
import fs from 'fs';
import path from 'path';
import { assert, describe, it } from 'vitest';
import * as dom from '../../src/html/dom';
import * as parser from '../../src/html/parser';
import {
  ServerElement,
  ServerTemplateElement,
} from '../../src/html/server-dom';

const docroot = path.join(__dirname, 'parser');

fs.readdirSync(docroot).forEach(file => {
  const filePath = path.join(docroot, file);
  if (fs.statSync(filePath).isFile() && file.endsWith('-in.html')) {
    it(file, async () => {
      const text = await fs.promises.readFile(filePath);
      const source = parser.parse(text.toString(), file);
      if (source.errors.length) {
        const fname = file.replace('-in.html', '-err.json');
        const pname = path.join(docroot, fname);
        const aerrs = source.errors.map(e => e.msg);
        let eerrs = [];
        try {
          const etext = (await fs.promises.readFile(pname)).toString();
          eerrs = JSON.parse(etext);
          assert.deepEqual(aerrs, eerrs);
        } catch (e) {
          assert.deepEqual(aerrs, eerrs);
        }
      } else {
        const actualHTML = source.doc!.toString() + '\n';
        const pname = path.join(docroot, file.replace('-in.', '-out.'));
        const expectedHTML = await fs.promises.readFile(pname, {
          encoding: 'utf8',
        });
        assert.equal(
          parser.normalizeText(actualHTML),
          parser.normalizeText(expectedHTML)
        );
      }
    });
  }
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
    /*  1 */ '<html :title=${"sample"}\n' +
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
    i2: 177,
  });

  {
    // root attributes
    const a1 = (root as ServerElement).attributes[0] as dom.Attribute;
    assert.equal(a1.name, ':title');
    assert.deepEqual(a1.loc, {
      source: 'inline',
      start: { line: 1, column: 6 },
      end: { line: 1, column: 24 },
      i1: 6,
      i2: 24,
    });
    assert.deepEqual(a1.valueLoc, {
      source: 'inline',
      start: { line: 1, column: 13 },
      end: { line: 1, column: 24 },
      i1: 13,
      i2: 24,
    });
    const exp1 = a1.value as acorn.Expression;
    assert.deepEqual(JSON.parse(JSON.stringify(exp1.loc)), {
      source: 'inline',
      start: { line: 1, column: 15 },
      end: { line: 1, column: 23 },
    });
    const a2 = (root as ServerElement).attributes[1] as dom.Attribute;
    assert.equal(a2.name, 'lang');
    assert.deepEqual(a2.loc, {
      source: 'inline',
      start: { line: 3, column: 6 },
      end: { line: 3, column: 15 },
      i1: 53,
      i2: 62,
    });
  }

  const rootText1 = root.childNodes[0]!;
  assert.equal(rootText1.nodeType, dom.NodeType.TEXT);
  assert.deepEqual(rootText1.loc, {
    source: 'inline',
    start: { line: 3, column: 16 },
    end: { line: 4, column: 2 },
    i1: 63,
    i2: 66,
  });

  const head = root.childNodes[1] as dom.Element;
  assert.equal(head.tagName, 'HEAD');
  assert.deepEqual(head.loc, {
    source: 'inline',
    start: { line: 4, column: 2 },
    end: { line: 8, column: 17 },
    i1: 66,
    i2: 137,
  });

  {
    // head content
    const style = head.childNodes[0] as dom.Element;
    assert.equal(style.tagName, 'STYLE');
    assert.deepEqual(style.loc, {
      source: 'inline',
      start: { line: 4, column: 8 },
      end: { line: 8, column: 10 },
      i1: 72,
      i2: 130,
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
      i1: 79,
      i2: 122,
    });
  }

  const rootText2 = root.childNodes[2]!;
  assert.equal(rootText2.nodeType, dom.NodeType.TEXT);
  assert.deepEqual(rootText2.loc, {
    source: 'inline',
    start: { line: 8, column: 17 },
    end: { line: 9, column: 2 },
    i1: 137,
    i2: 140,
  });

  const body = root.childNodes[3] as dom.Element;
  assert.equal(body.tagName, 'BODY');
  assert.deepEqual(body.loc, {
    source: 'inline',
    start: { line: 9, column: 2 },
    end: { line: 11, column: 9 },
    i1: 140,
    i2: 169,
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
      i1: 146,
      i2: 151,
    });

    const bodyText2 = body.childNodes[1] as dom.Text;
    assert.equal(bodyText2.nodeType, dom.NodeType.TEXT);
    assert.equal(typeof bodyText2.textContent, 'object');
    assert.deepEqual(bodyText2.loc, {
      source: 'inline',
      start: { line: 10, column: 4 },
      end: { line: 10, column: 12 },
      i1: 151,
      i2: 159,
    });

    const bodyText3 = body.childNodes[2] as dom.Text;
    assert.equal(bodyText3.nodeType, dom.NodeType.TEXT);
    assert.deepEqual(bodyText3.loc, {
      source: 'inline',
      start: { line: 10, column: 12 },
      end: { line: 11, column: 2 },
      i1: 159,
      i2: 162,
    });
  }

  const rootText3 = root.childNodes[4]!;
  assert.equal(rootText3.nodeType, dom.NodeType.TEXT);
  assert.deepEqual(rootText3.loc, {
    source: 'inline',
    start: { line: 11, column: 9 },
    end: { line: 12, column: 0 },
    i1: 169,
    i2: 170,
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
