import { describe, expect, it } from 'vitest';
import { Page } from '../../src/compiler/ir/Page';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../src/compiler/stages/stage7-generate';
import { parse } from '../../src/html/parser';
import { renderPage } from '../../src/server/render';

function render(html: string) {
  const page = new Page(parse(html, 'test.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  stage7generate(page);
  const runtimeErrors = page.errors.length ? [] : renderPage(page);
  const markup = page.source.doc.toString();
  return {
    errors: page.errors,
    runtimeErrors,
    // only what's actually live: a <template> holds an inert stencil, which
    // renders too but never reaches the page
    body: markup.slice(markup.indexOf('<body'), markup.indexOf('<script')),
  };
}

// A custom tag inside a :for-each or a <:define> used to be skipped in
// silence -- the usage sits inside a <template>, invisible to the childNodes
// walk that collects usages, so the tag survived into the served markup and
// rendered nothing at all.
describe('custom tags inside replicated markup', () => {
  it('instantiates a component once per :for-each replica', () => {
    const { errors, runtimeErrors, body } = render(
      '<html><head><:define tag="my-card:div" class="card" :title="T">' +
        '<h5>${title}</h5></:define></head>' +
        '<body><div :for-each=${["a", "b"]}><my-card :title=${data} /></div></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    // each replica gets its own instance, reading that replica's own item --
    // proof the usage-site expression evaluates at the call site
    expect(body).toContain('>a<');
    expect(body).toContain('>b<');
    expect(body.match(/class="card"/g)!.length).toBeGreaterThanOrEqual(2);
    expect(body).not.toContain('<my-card');
  });

  it('lets one component use another', () => {
    const { errors, runtimeErrors, body } = render(
      '<html><head>' +
        '<:define tag="my-badge:span" class="badge" :label="B">${label}</:define>' +
        '<:define tag="my-card:div" class="card" :title="T">' +
        '<h5>${title}</h5><my-badge :label="inner" /></:define>' +
        '</head><body><my-card :title="hello" /></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    expect(body).toContain('hello');
    expect(body).toContain('inner');
    expect(body).toContain('class="badge"');
    expect(body).not.toContain('<my-badge');
  });

  it('keeps a definition reading its own scope, not the call site', () => {
    // the point of the lexical/structural split: `gap` is declared BOTH on
    // the page (where the definition can see it) and on the element the tag
    // is used in. A component must read the one visible where it was
    // DEFINED, or dropping it into a new context would silently change it
    const { errors, runtimeErrors, body } = render(
      '<html :gap=${1}><head><:define tag="my-gap:i">${gap}</:define></head>' +
        '<body><section :gap=${99}><my-gap /></section></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    expect(body).toContain('>1<');
    expect(body).not.toContain('>99<');
  });

  it('still resolves a usage-site expression at the call site', () => {
    // the other half of the same rule: this expression was written in the
    // page, so it reads the page's `gap` even though it lands on an instance
    const { errors, runtimeErrors, body } = render(
      '<html><head><:define tag="my-gap:i" :n=${0}>${n}</:define></head>' +
        '<body><section :gap=${99}><my-gap :n=${gap} /></section></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    expect(body).toContain('>99<');
  });
});
