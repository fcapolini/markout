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

// `<:slot>` marks where a definition takes the children written at a usage
// site. They used to be dropped in silence.
describe('slots', () => {
  it('puts a usage site content where the definition asks for it', () => {
    const { errors, runtimeErrors, body } = render(
      '<html><head><:define tag="my-box:div" class="box">' +
        '<h5>head</h5><div class="body"><:slot /></div></:define></head>' +
        '<body><my-box><p>slotted</p></my-box></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    expect(body).toContain('<div class="body"><p>slotted</p></div>');
  });

  it('falls back to the slot own content when a usage supplies none', () => {
    const { errors, body } = render(
      '<html><head><:define tag="my-box:div"><:slot>nothing here</:slot></:define></head>' +
        '<body><my-box /></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(body).toContain('nothing here');
    // the directive tag itself never reaches the page
    expect(body).not.toContain(':slot');
  });

  it('resolves slotted markup against the call site, not the definition', () => {
    // `label` exists on both: the slot content was written in the page, so it
    // must read the page's -- otherwise moving markup into a component would
    // silently change what it means
    const { errors, runtimeErrors, body } = render(
      '<html :label=${"page"}><head>' +
        '<:define tag="my-box:div" :label=${"definition"}><:slot /></:define>' +
        '</head><body><my-box>${label}</my-box></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    expect(body).toContain('>page<');
    expect(body).not.toContain('definition');
  });

  it('binds bare interpolated text alongside the definition own text', () => {
    // text is bound by POSITION within a scope's territory, so slotted text
    // landing between the definition's own has to be re-keyed in document
    // order or every binding after it shifts
    const { errors, runtimeErrors, body } = render(
      '<html :who=${"world"}><head>' +
        '<:define tag="my-box:div" :top=${"T"} :tail=${"E"}>' +
        '${top}<:slot />${tail}</:define>' +
        '</head><body><my-box>-hello ${who}-</my-box></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    expect(body.replace(/<!--.*?-->/g, '')).toContain('T-hello world-E');
  });

  it('gives every :for-each replica its own slotted content', () => {
    const { errors, runtimeErrors, body } = render(
      '<html><head><:define tag="my-box:div" class="box"><:slot /></:define></head>' +
        '<body><ul><li :for-each=${[1, 2]}><my-box>item ${data}</my-box></li></ul></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    const live = body.slice(body.indexOf('</template>'));
    expect(live).toContain('item <!---t0-->1');
    expect(live).toContain('item <!---t0-->2');
  });

  it('reports content given to a definition with no <:slot>', () => {
    const { errors } = render(
      '<html><head><:define tag="my-box:div">x</:define></head>' +
        '<body><my-box>dropped</my-box></body></html>'
    );

    expect(errors.length).toBe(1);
    expect(errors[0].msg).toContain('my-box');
    expect(errors[0].msg).toContain(':slot');
  });
});

// `<:slot name="x" />` in the definition, `:slot="x"` on a usage child. An
// attribute rather than a wrapper element, so filling a slot adds no markup.
describe('named slots', () => {
  const PANEL =
    '<:define tag="my-panel:section" class="panel" :title="T">' +
    '<header><:slot name="header">${title}</:slot></header>' +
    '<div class="body"><:slot /></div>' +
    '<footer><:slot name="footer">(none)</:slot></footer>' +
    '</:define>';

  it('routes each child to the slot it names, and the rest to the default', () => {
    const { errors, runtimeErrors, body } = render(
      `<html :who=\${"world"}><head>${PANEL}</head><body>` +
        '<my-panel :title="T"><h2 :slot="header">Custom ${who}</h2>' +
        'body ${who}<p>more</p></my-panel></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    const clean = body.replace(/<!--.*?-->/g, '');
    expect(clean).toContain('<header><h2>Custom world</h2></header>');
    expect(clean).toContain('body world<p>more</p>');
    // the routing attribute is consumed, not emitted
    expect(body).not.toContain(':slot');
    expect(body).not.toContain('slot=');
  });

  it('falls back per slot, independently', () => {
    const { errors, runtimeErrors, body } = render(
      `<html><head>${PANEL}</head><body>` +
        '<my-panel :title="mine"><p :slot="footer">bye</p></my-panel></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    const clean = body.replace(/<!--.*?-->/g, '');
    // header keeps its fallback, footer takes the supplied content
    expect(clean).toContain('<header>mine</header>');
    expect(clean).toContain('<footer><p>bye</p></footer>');
  });

  it('reports content addressed to a slot the definition has not got', () => {
    const { errors } = render(
      `<html><head>${PANEL}</head><body>` +
        '<my-panel :title="T"><p :slot="sidebar">x</p></my-panel></body></html>'
    );

    expect(errors.length).toBe(1);
    expect(errors[0].msg).toContain('sidebar');
  });
});

// slotted content can name custom tags of its own; collect() used to stop
// descending at a usage site, so those were left unexpanded and silent
describe('custom tags inside slotted content', () => {
  const LIB =
    '<:define tag="my-badge:span" class="badge" :label="B">${label}</:define>' +
    '<:define tag="my-card:div" class="card"><:slot /></:define>';

  it('expands a component slotted into another component', () => {
    const { errors, runtimeErrors, body } = render(
      `<html :who=\${"world"}><head>${LIB}</head><body>` +
        '<my-card><my-badge :label=${who} /> and ${who}</my-card></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    // the nested tag's own usage-site value resolves at the OUTER call site,
    // not against the instance it happens to sit inside
    const clean = body.replace(/<!--.*?-->/g, '').replace(/ data-markout="[^"]*"/g, '');
    expect(clean).toContain('<span class="badge">world</span> and world');
    expect(body).not.toContain('<my-badge');
  });

  it('resolves through two levels of slotting', () => {
    const { errors, runtimeErrors, body } = render(
      `<html :who=\${"deep"}><head>${LIB}</head><body>` +
        '<my-card><my-card><my-badge :label=${who} /></my-card></my-card>' +
        '</body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    const clean = body.replace(/<!--.*?-->/g, '').replace(/ data-markout="[^"]*"/g, '');
    expect(clean).toContain('<span class="badge">deep</span>');
  });

  it('keeps the nested definition reading its own scope', () => {
    // `label` is declared on the page too: the badge's own body was written
    // in the definition, so it must still read the definition's default
    const { errors, runtimeErrors, body } = render(
      `<html :label=\${"page"}><head>${LIB}</head><body>` +
        '<my-card><my-badge /></my-card></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    const clean = body.replace(/<!--.*?-->/g, '').replace(/ data-markout="[^"]*"/g, '');
    expect(clean).toContain('<span class="badge">B</span>');
    expect(clean).not.toContain('page');
  });
});
