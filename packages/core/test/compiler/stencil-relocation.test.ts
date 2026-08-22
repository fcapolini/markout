import { describe, expect, it } from 'vitest';
import { Page } from '../../src/compiler/ir/Page';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../src/compiler/stages/stage7-generate';
import { parse } from '../../src/html/parser';

/**
 * What stage7 makes of a region's markup, asked of the compiler alone.
 *
 * The runtime and browser suites assert what these arrangements DO; this
 * one asserts they are there at all, because two of them are otherwise
 * pinned by a single test apiece and are invisible from anywhere else: a
 * stencil written in foreign content carries the element naming its
 * namespace, and one that can have at most one live scope says so.
 */
function compile(html: string) {
  const page = new Page(parse(html, 'r.html'));
  page.errors = page.source.errors;
  page.errors.length || stage1load(page);
  page.errors.length || stage2validate(page);
  page.errors.length || stage3qualify(page);
  page.errors.length || stage4resolve(page);
  const errors = page.errors.map(e => e.msg);
  errors.length || stage7generate(page);
  const markup = page.source.doc.toString();
  return {
    errors,
    head: markup.slice(0, markup.indexOf('<body')),
    body: markup.slice(markup.indexOf('<body'), markup.indexOf('<script')),
  };
}

describe('where a stencil ends up', () => {
  it('leaves a marker naming the scope and the stencil, and nothing else', () => {
    const r = compile('<html><head></head><body><p :if=${true}>x</p></body></html>');
    expect(r.errors).toStrictEqual([]);
    expect(r.body).toMatch(/<!---c[^.]+\.q0-->/);
    expect(r.body).not.toContain('<template');
    expect(r.head).toContain('<template data-markout-stencil="q0"');
  });

  it('says which stencils can ever be spent, and which cannot', () => {
    // an optional arity standing outside anything replicated has one live
    // scope and one only, so a render that finds its element in the page can
    // drop it (render.ts). Inside a `:for-each` the same markup serves every
    // replica; a `:for-each` host serves replica n+1
    const r = compile(
      '<html><head></head><body>' +
        '<p :if=${true}>alone</p>' +
        '<ul><li :for-each=${[1]}><b :if=${true}>nested</b></li></ul>' +
        '</body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    const once = [...r.head.matchAll(/data-markout-stencil="(q\d+)"( data-markout-once)?/g)];
    expect(once.map(m => [m[1], !!m[2]])).toStrictEqual([
      ['q0', true], // the lone `:if`
      ['q1', false], // the `:for-each` host
      ['q2', false], // the `:if` inside it
    ]);
  });

  it('carries markup written in SVG with the element that names its namespace', () => {
    // `<circle>` is an SVG circle inside `<svg>` and an unknown HTML element
    // anywhere else, and a stencil in <head> is anywhere else
    const r = compile(
      '<html><head></head><body><svg><circle :if=${true} r="1" /></svg></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.head).toMatch(/<template data-markout-stencil="q0"[^>]*><svg><circle/);
  });

  it('does not carry markup written back out of it', () => {
    // <foreignObject> is HTML again, and an <svg> around it would put it in
    // the wrong namespace just as surely as none would
    const r = compile(
      '<html><head></head><body><svg><foreignObject>' +
        '<b :if=${true}>x</b></foreignObject></svg></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.head).toMatch(/<template data-markout-stencil="q0"[^>]*><b/);
  });

  it('gives two copies of one definition two stencils', () => {
    // a <:define> body is cloned per usage site that fills a slot, and the
    // copies keep the scope ids they were copied from -- so a stencil keyed
    // by scope id would have two of them answering to one name
    const r = compile(
      '<html><head><:define tag="my-box:div"><i :if=${true}>a</i><:slot /></:define></head>' +
        '<body><my-box>one</my-box><my-box>two</my-box></body></html>'
    );
    expect(r.errors).toStrictEqual([]);
    const keys = [...r.head.matchAll(/data-markout-stencil="(q\d+)"/g)].map(m => m[1]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThan(1);
  });
});

describe('a region on the elements a page is made of', () => {
  // it renders and ships completely inert: `document.body` answers with a
  // direct child of <html> and nothing else, so a <body> in a stencil is no
  // body at all and the bootstrap scripts have nowhere to go
  for (const [tag, page] of [
    ['html', '<html :if=${true}><head></head><body>b</body></html>'],
    ['head', '<html><head :if=${true}></head><body>b</body></html>'],
    ['body', '<html><head></head><body :if=${true}>b</body></html>'],
    ['body', '<html><head></head><body :for-each=${[1, 2]}>b</body></html>'],
  ]) {
    it(`is refused on <${tag}>`, () => {
      const r = compile(page);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toContain(`<${tag}> cannot carry`);
      expect(r.errors[0]).toContain('Put it on an element inside');
    });
  }
});
