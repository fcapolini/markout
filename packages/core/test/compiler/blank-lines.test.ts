import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';

/**
 * The blank lines compiling a page leaves behind, closed up.
 *
 * An `<:import>`, a `<:define>`, a `<:logic>` or a region's markup goes out
 * of the tree and the whitespace indenting it stays -- as SEPARATE text
 * nodes either side of where the element was, which is why they stack into
 * runs rather than merging. Done on the node tree rather than over the
 * serialized markup: that is what tells a static whitespace node from an
 * interpolation's (whose content is an expression until something renders
 * it), and what lets `<pre>` and `<script>` be skipped by name.
 */
let docroot: string;
let seq = 0;

beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-blank-'));
  fs.writeFileSync(
    path.join(docroot, 'lib.htm'),
    '<lib>\n  <:define tag="my-box:div"><:slot /></:define>\n</lib>\n'
  );
});
afterAll(() => fs.rmSync(docroot, { recursive: true, force: true }));

async function compile(source: string) {
  const name = `b${seq++}.html`;
  fs.writeFileSync(path.join(docroot, name), source);
  const page = await new Compiler({ docroot }).compile(`/${name}`);
  expect(page.errors.map(e => e.msg)).toStrictEqual([]);
  // cut at the bootstrap rather than at the first <script>, which a page
  // under test is entitled to have written itself. The props data block is
  // the first thing markout appends
  const html = page.source.doc.toString();
  const bootstrap = html.indexOf('<script type="application/json"');
  return bootstrap < 0 ? html : html.slice(0, bootstrap);
}

/** `\n` followed by another, with only spaces or tabs in between */
const blankLines = (html: string) => (html.match(/\n[ \t]*\n/g) ?? []).length;

describe('blank lines in compiled markup', () => {
  it('leaves none where the compiler took an element out', async () => {
    const out = await compile(
      '<html>\n  <head>\n    <title>t</title>\n' +
        '    <:import src="lib.htm"/>\n  </head>\n' +
        '  <body>\n    <:logic :aka="a" :n=${1} />\n' +
        '    <:logic :aka="b" :n=${2} />\n    <p>after</p>\n  </body>\n</html>\n'
    );
    expect(blankLines(out)).toBe(0);
    // and the line that follows keeps its indentation, which is the whole
    // reason this closes lines up rather than stripping whitespace
    expect(out).toContain('\n    <p>after</p>');
  });

  it('closes up the ones the author wrote too', async () => {
    const out = await compile(
      '<html>\n  <head></head>\n  <body>\n    <p>one</p>\n\n\n    <p>two</p>\n  </body>\n</html>\n'
    );
    expect(blankLines(out)).toBe(0);
    expect(out).toContain('<p>one</p>\n    <p>two</p>');
  });

  it('keeps a single break, which is ordinary indentation', async () => {
    const out = await compile(
      '<html>\n  <head></head>\n  <body>\n    <p>one</p>\n    <p>two</p>\n  </body>\n</html>\n'
    );
    expect(out).toContain('<p>one</p>\n    <p>two</p>');
  });

  it('does not touch an element whose whitespace is its content', async () => {
    const out = await compile(
      '<html>\n  <head></head>\n  <body>\n' +
        '    <pre>one\n\n\ntwo</pre>\n' +
        '    <textarea>a\n\n\nb</textarea>\n  </body>\n</html>\n'
    );
    expect(out).toContain('<pre>one\n\n\ntwo</pre>');
    expect(out).toContain('<textarea>a\n\n\nb</textarea>');
  });

  it('does not touch somebody else\'s language', async () => {
    // a removed line moves every line number after it, and a template
    // literal is text a page can see
    const out = await compile(
      '<html>\n  <head>\n    <style>\n\n\n.a { color: red }\n</style>\n  </head>\n' +
        '  <body>\n    <script>\n\n\nconsole.log(1);\n</script>\n  </body>\n</html>\n'
    );
    expect(out).toContain('<style>\n\n\n.a { color: red }\n</style>');
    expect(out).toContain('<script>\n\n\nconsole.log(1);\n</script>');
  });

  it('leaves the whitespace between two interpolations alone', async () => {
    // it separates two rendered values, so it is content rather than layout
    const out = await compile(
      '<html>\n  <head></head>\n  <body :a=${1} :b=${2}>\n    <p>${a} ${b}</p>\n  </body>\n</html>\n'
    );
    expect(out).toContain('<!---/--> <!---t1-->');
  });
});
