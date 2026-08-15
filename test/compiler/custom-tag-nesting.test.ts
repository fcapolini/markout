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

  it('replicates a custom tag that carries :for-each itself', () => {
    // no wrapper element: the tag IS the replica. `:for-each` declares the
    // per-item name where the instance scope is defined -- at the usage site
    // -- so the attribute written beside it reads that name like any other
    // call-site expression
    const { errors, runtimeErrors, body } = render(
      '<html><head><:define tag="my-card:div" class="card" :title="T">' +
        '<h5>${title}</h5></:define></head>' +
        '<body><my-card :for-each=${["a", "b"]} :title=${data} /></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    expect(body).not.toContain('<my-card');
    const live = body.slice(body.indexOf('</template>'));
    expect(live).toContain('>a<');
    expect(live).toContain('>b<');
    expect(live.match(/class="card"/g)!.length).toBe(2);
  });

  it('keeps the definition blind to the name :for-each introduced', () => {
    // only the loop's alias crosses to the usage site. A definition resolves
    // where it was DEFINED, so `data` in its body is the page's value, never
    // the caller's item -- otherwise a component would silently read its
    // call site just by naming something the caller happened to loop over
    const { errors, runtimeErrors, body } = render(
      '<html :data=${"page-data"}><head>' +
        '<:define tag="my-card:div" class="card">${data}</:define></head>' +
        '<body><my-card :for-each=${["a", "b"]} /></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    const live = body.slice(body.indexOf('</template>'));
    expect(live).toContain('page-data');
    expect(live).not.toContain('>a<');
  });

  it('does not let a usage-site value resolve to itself', () => {
    // the alias is the ONLY name the loop adds at the usage site: passing a
    // page value through under its own name still means the page's, not this
    // attribute and not the definition's default
    const { errors, runtimeErrors, body } = render(
      '<html :title=${"from-page"}><head>' +
        '<:define tag="my-card:div" class="card" :title="definition">${title}</:define>' +
        '</head><body><my-card :for-each=${[1]} :title=${title} /></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    const live = body.slice(body.indexOf('</template>'));
    expect(live).toContain('from-page');
    expect(live).not.toContain('definition');
  });

  it('lets markup slotted into a replicated tag see that name too', () => {
    // slotted content is written at the usage site like the attributes
    // beside it, so the same rule reaches it. Both forms: an attribute used
    // to be a compile error, and text used to compile and then render empty
    const { errors, runtimeErrors, body } = render(
      '<html><head><:define tag="my-card:div" class="card"><:slot /></:define></head>' +
        '<body><my-card :for-each=${["a", "b"]}><i data-v=${data}>${data}</i></my-card>' +
        '</body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    const live = body
      .slice(body.indexOf('</template>'))
      .replace(/<!--.*?-->/g, '')
      .replace(/ data-markout="[^"]*"/g, '');
    expect(live).toContain('<i data-v="a">a</i>');
    expect(live).toContain('<i data-v="b">b</i>');
  });

  it('keeps slotted content resolving at the call site for everything else', () => {
    // the alias is an addition, not a replacement: a name the page declares
    // still resolves to the page's, and the definition's stays invisible
    const { errors, runtimeErrors, body } = render(
      '<html :tone=${"page"}><head>' +
        '<:define tag="my-card:div" class="card" :tone=${"definition"}><:slot /></:define>' +
        '</head><body><my-card :for-each=${[1]}>${tone}</my-card></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    const live = body.slice(body.indexOf('</template>'));
    expect(live).toContain('page');
    expect(live).not.toContain('definition');
  });

  it('still expands a custom tag that merely sits inside a stencil', () => {
    // the containment fix must not over-reach: a usage nested anywhere in
    // replicated markup is fine, it is only the host element that is refused
    const { errors, runtimeErrors, body } = render(
      '<html><head><:define tag="my-card:div" class="card" :title="T">' +
        '<h5>${title}</h5></:define></head>' +
        '<body><ul><li :for-each=${["a", "b"]}><span><my-card :title=${data} /></span></li></ul></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    expect(body).not.toContain('<my-card');
    expect(body).toContain('>a<');
    expect(body).toContain('>b<');
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

  it('resolves slotted text at the call site even when the usage has attributes', () => {
    // any `:` attribute gives the usage a scope of its own, and expansion
    // used to hand the instance a fresh call-site-values set at that point,
    // dropping the marking slotting had just put on the slotted TEXT. The
    // symptom was silent and backwards: `${tone}` written in the page read
    // the component's own `tone`, and only when the tag had an attribute
    const { errors, runtimeErrors, body } = render(
      '<html :tone=${"page"}><head>' +
        '<:define tag="my-card:div" class="card" :tone=${"definition"}><:slot /></:define>' +
        '</head><body><my-card :x=${1}>${tone}</my-card></body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    expect(body).toContain('page');
    expect(body).not.toContain('definition');
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

  it('drops a component in the fallback of a slot that was filled', () => {
    // the fallback is expanded before the slot is filled, so what stands in
    // the markup by then is the usage's `-u<id>` marker rather than its tag
    // -- and a filter looking for the ELEMENT inside the replaced region
    // missed it. The scope stayed on an instance whose fallback was gone: a
    // component with no markup at all, reporting each of its bindings
    // unbound, in exactly the instances that supplied their own footer
    const DIALOG =
      '<:define tag="my-btn:button" class="btn" :kind="x" data-kind=${kind}><:slot /></:define>' +
      '<:define tag="my-dialog:div" class="dlg">' +
      '<div class="body"><:slot /></div>' +
      '<div class="foot"><:slot name="foot">' +
      '<my-btn :kind="close">Close</my-btn></:slot></div>' +
      '</:define>';
    const { errors, runtimeErrors, body } = render(
      `<html><head>${DIALOG}</head><body>` +
        '<my-dialog><p>one</p><span :slot="foot"><my-btn :kind="go">Go</my-btn></span></my-dialog>' +
        '<my-dialog><p>two</p></my-dialog>' +
        '</body></html>'
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    const clean = body.replace(/<!--.*?-->/g, '');
    // the filled one took the supplied button, and only that one
    expect(clean).toContain('data-kind="go"');
    // the untouched one still gets its fallback
    expect(clean).toContain('data-kind="close"');
    expect(clean.match(/data-kind="close"/g)).toHaveLength(1);
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

// a <:define> whose slot sits inside its own :for-each -- the interaction
// between per-usage slotting and per-replica stamping
describe('a slot inside the definition own :for-each', () => {
  const LIST =
    '<:define tag="my-list:ul" :items=${["a", "b"]}>' +
    '<li :for-each=${items}><:slot>item ${data}</:slot></li>' +
    '</:define>';

  it('replicates the slot fallback once per item', () => {
    const { errors, runtimeErrors, body } = render(
      `<html><head>${LIST}</head><body><my-list /></body></html>`
    );

    expect(errors).toStrictEqual([]);
    expect(runtimeErrors).toStrictEqual([]);
    // past the inert stencil, which renders too but never reaches the page
    const live = body.slice(body.indexOf('</template>'));
    expect(live).toContain('item <!---t0-->a');
    expect(live).toContain('item <!---t0-->b');
  });

  it('reports a usage that tries to fill it', () => {
    // the content would be stamped out per replica, but there is only one
    // set of scopes for it -- so this is refused rather than expanded wrong.
    // The message has to name the real problem: the slot IS there, and
    // saying otherwise sends the author looking in the wrong place
    const { errors } = render(
      `<html><head>${LIST}</head><body><my-list><b>x</b></my-list></body></html>`
    );

    expect(errors.length).toBe(1);
    expect(errors[0].msg).toContain(':for-each');
    expect(errors[0].msg).not.toContain('has no');
  });

  it('reports it for a named slot too', () => {
    const { errors } = render(
      '<html><head><:define tag="my-list:ul" :items=${[1]}>' +
        '<li :for-each=${items}><:slot name="row" /></li>' +
        '</:define></head>' +
        '<body><my-list><b :slot="row">x</b></my-list></body></html>'
    );

    expect(errors.length).toBe(1);
    expect(errors[0].msg).toContain('"row"');
    expect(errors[0].msg).toContain(':for-each');
  });
});
