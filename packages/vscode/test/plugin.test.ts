import { describe, expect, it } from 'vitest';
import { createMarkoutLanguagePlugin, snapshotOf } from '../src/plugin';
import type { VirtualCode } from '@volar/language-core';

/**
 * The virtual code a page becomes, and whether its offsets still point at
 * what they claim to.
 *
 * A mapping that is wrong is worse than a mapping that is missing: the
 * editor keeps working, and quietly answers about the wrong characters. So
 * these check the arithmetic against the source text rather than against a
 * snapshot of what the code happened to produce.
 */

function codesOf(source: string): { root: VirtualCode; embedded: VirtualCode[] } {
  const plugin = createMarkoutLanguagePlugin();
  const root = plugin.createVirtualCode!(
    { path: '/index.html' } as never,
    'html',
    snapshotOf(source),
    undefined as never
  )!;
  return { root, embedded: root.embeddedCodes ?? [] };
}

function textOf(code: VirtualCode): string {
  return code.snapshot.getText(0, code.snapshot.getLength());
}

describe('what the plugin claims', () => {
  it('claims pages and fragments as HTML, not as a language of its own', () => {
    const plugin = createMarkoutLanguagePlugin();
    const id = (p: string) => plugin.getLanguageId({ path: p } as never);
    // `html`, deliberately: a language of our own would REPLACE VS Code's
    // for every .html file on the machine, taking Emmet and the built-in
    // IntelliSense with it. Markout extends HTML; so does its tooling
    expect(id('/index.html')).toBe('html');
    expect(id('/parts/card.htm')).toBe('html');
    expect(id('/app.css')).toBeUndefined();
    expect(id('/server.ts')).toBeUndefined();
  });
});

describe('the embedded HTML', () => {
  const source = '<div :n=${a > b} class="x">${n}</div>';

  it('is the same length as the source, so offsets need no translation', () => {
    const [html] = codesOf(source).embedded;
    expect(textOf(html)).toHaveLength(source.length);
  });

  it('masks the expressions and leaves the markup alone', () => {
    const [html] = codesOf(source).embedded;
    const generated = textOf(html);
    // the `>` inside the expression is gone, which is the whole reason to mask
    expect(generated).toBe('<div :n=________ class="x">____</div>');
    expect(generated).not.toContain('a > b');
    // and what an HTML parser needs is intact
    expect(generated).toContain('class="x"');
    expect(generated.indexOf('</div>')).toBe(source.indexOf('</div>'));
  });

  it('keeps line breaks, so a multi-line expression does not move the lines after it', () => {
    const multi = '<x :v=${[\n  1,\n  2,\n]} />\n<y />';
    const [html] = codesOf(multi).embedded;
    const generated = textOf(html);
    expect(generated.split('\n')).toHaveLength(multi.split('\n').length);
    expect(generated.indexOf('<y />')).toBe(multi.indexOf('<y />'));
  });

  it('maps one to one over the whole file', () => {
    const [html] = codesOf(source).embedded;
    const [m] = html.mappings;
    expect(m.sourceOffsets).toStrictEqual([0]);
    expect(m.generatedOffsets).toStrictEqual([0]);
    expect(m.lengths).toStrictEqual([source.length]);
  });
});

describe('the embedded expressions', () => {
  const source = '<div :n=${a > b} class="x">${n * 2}</div>';

  it('is one document per expression, holding just the JavaScript', () => {
    const js = codesOf(source).embedded.filter(c => c.languageId === 'javascript');
    expect(js.map(textOf)).toStrictEqual(['a > b', 'n * 2']);
  });

  it('points back at the characters it came from', () => {
    for (const code of codesOf(source).embedded.filter(c => c.languageId === 'javascript')) {
      const [m] = code.mappings;
      const from = m.sourceOffsets[0];
      const length = m.lengths[0];
      // the source text at the mapped offsets IS the generated text: the one
      // property the whole extension rests on
      expect(source.slice(from, from + length)).toBe(textOf(code));
      expect(m.generatedOffsets).toStrictEqual([0]);
    }
  });

  it('does not ask for verification it cannot back up', () => {
    const [js] = codesOf(source).embedded.filter(c => c.languageId === 'javascript');
    // a type checker with no model of the scope chain would call every value
    // in the page undefined, so this stays off until there is one
    expect(js.mappings[0].data.verification).toBe(false);
    expect(js.mappings[0].data.completion).toBe(true);
  });

  it('produces none for a page with no expressions', () => {
    const plain = codesOf('<html><body>plain</body></html>');
    expect(plain.embedded.filter(c => c.languageId === 'javascript')).toStrictEqual([]);
    expect(plain.embedded).toHaveLength(1);
  });
});
