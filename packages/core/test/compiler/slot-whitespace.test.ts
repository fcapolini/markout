import { assert, describe, it } from 'vitest';
import { Page } from '../../src/compiler/ir/Page';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../src/compiler/stages/stage7-generate';
import { parse } from '../../src/html/parser';
import { WebContext } from '../../src/runtime/web/web-context';
import { loadProps } from '../../src/render/props';

/**
 * What happens to the text nodes sitting directly inside a usage site when
 * its content is moved into a slot.
 *
 * They used to be filtered out whenever they held nothing but whitespace,
 * which conflates two different things: the indentation AROUND a usage site,
 * which no container renders, and the space BETWEEN two pieces that end up
 * side by side in the slot, which every browser does render. Dropping the
 * second ran `<span>a</span> <span>b</span>` together -- a rendering change
 * with no error, no warning, and nothing in the DOM to explain it.
 *
 * Asserted on the served markup rather than a scope tree: the whole question
 * is what the browser is handed.
 */
function render(html: string): string {
  const page = new Page(parse(html, 'test.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  assert.deepEqual(
    page.errors.map((e: any) => e.msg),
    [],
    'expected the page to compile cleanly'
  );
  stage7generate(page);
  const { root, exps } = loadProps(page.propsString);
  new WebContext({ root, exps, doc: page.source.doc }).refresh();
  const body = findByTag(page.source.doc, 'BODY');
  const out = body
    .toString()
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<template[\s\S]*?<\/template>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  return /<main>([\s\S]*)<\/main>/.exec(out)![1];
}

function findByTag(root: any, tagName: string): any {
  for (const n of root.childNodes ?? []) {
    if (n.tagName === tagName) return n;
    const found = findByTag(n, tagName);
    if (found) return found;
  }
  return undefined;
}

// one plain slot, one with fallback content, and one with two named slots
const DEFS =
  '<:define tag="mk-box:div"><:slot /></:define>' +
  '<:define tag="mk-fallback:div"><:slot>FALLBACK</:slot></:define>' +
  '<:define tag="mk-two:div"><:slot name="h" /><hr /><:slot name="b" /></:define>';

function page(inner: string) {
  return `<html><body>${DEFS}<main>${inner}</main></body></html>`;
}

describe('whitespace in slotted content', () => {
  it('keeps the space between two elements filling the same slot', () => {
    // the reported bug, and the shape it was found in: two inline badges
    // written `</span> <span>` came out of the slot touching
    assert.equal(
      render(page('<mk-box><span>a</span> <span>b</span></mk-box>')),
      '<div class="" data-markout="s7"><span>a</span> <span>b</span></div>'
    );
  });

  it('keeps a newline-and-indent gap, which renders as a space', () => {
    assert.equal(
      render(page('<mk-box>\n    <span>a</span>\n    <span>b</span>\n  </mk-box>')),
      '<div class="" data-markout="s7"><span>a</span>\n    <span>b</span></div>'
    );
  });

  it('keeps a deliberate &nbsp; between elements', () => {
    // `.trim()` strips U+00A0, so this counted as blank and was discarded
    // with the indentation -- the one case where "it was only whitespace"
    // is plainly wrong
    assert.equal(
      render(page('<mk-box><span>a</span>&nbsp;<span>b</span></mk-box>')),
      '<div class="" data-markout="s7"><span>a</span> <span>b</span></div>'
    );
  });

  it('treats content that is only &nbsp; as content', () => {
    assert.equal(
      render(page('<mk-fallback>&nbsp;</mk-fallback>')),
      '<div class="" data-markout="s7"> </div>'
    );
  });

  it('drops the indentation around the content', () => {
    // formatting, not content: a container renders neither, and carrying
    // them in would put the usage site's source layout in the page
    assert.equal(
      render(page('<mk-box>\n    <span>a</span>\n  </mk-box>')),
      '<div class="" data-markout="s7"><span>a</span></div>'
    );
  });

  it('still falls back when the content is only whitespace', () => {
    assert.equal(
      render(page('<mk-fallback>   \n  </mk-fallback>')),
      '<div class="" data-markout="s7">FALLBACK</div>'
    );
  });

  it('drops the gap between pieces addressed to different slots', () => {
    // they are about to be pulled apart, so the space between them in the
    // source separates nothing. It must also not be read as content for the
    // DEFAULT slot, which this definition does not have -- that would be a
    // compile error for entirely well-formed markup
    assert.equal(
      render(page('<mk-two>\n    <i :slot="h">H</i>\n    <i :slot="b">B</i>\n  </mk-two>')),
      '<div class="" data-markout="s7"><i>H</i><hr><i>B</i></div>'
    );
  });

  it('keeps the gap between two pieces addressed to the SAME named slot', () => {
    assert.equal(
      render(page('<mk-two><i :slot="h">H1</i> <i :slot="h">H2</i><i :slot="b">B</i></mk-two>')),
      '<div class="" data-markout="s7"><i>H1</i> <i>H2</i><hr><i>B</i></div>'
    );
  });

  it('leaves text that is not whitespace alone, padding included', () => {
    assert.equal(
      render(page('<mk-box>  x  </mk-box>')),
      '<div class="" data-markout="s7">  x  </div>'
    );
  });
});
