import { describe, expect, it } from 'vitest';
import { Page } from '../src/compiler/ir/Page';
import { stage1load } from '../src/compiler/stages/stage1-load';
import { stage2validate } from '../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../src/compiler/stages/stage7-generate';
import { parse } from '../src/html/parser';
import { renderPage } from '../src/server/render';
import { WebContext } from '../src/runtime/web/web-context';

// Every example in docs/ that a reader would type in, compiled and rendered.
// Documentation that doesn't run is worse than none: it costs the reader the
// time to find out, and it is exactly what goes stale first.

function render(html: string) {
  const page = new Page(parse(html, 'docs.html'));
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
    body: markup
      .slice(markup.indexOf('<body'), markup.indexOf('<script'))
      .replace(/<!--.*?-->/g, '')
      .replace(/ data-markout="[^"]*"/g, ''),
  };
}

function expectClean(result: ReturnType<typeof render>) {
  expect(result.errors).toStrictEqual([]);
  expect(result.runtimeErrors).toStrictEqual([]);
}

describe('docs/concepts/values.md', () => {
  it('renders the interpolated-attribute example', () => {
    const result = render(
      '<html :section=${{ id: "top", title: "Top" }}><body>' +
        "<a href=${'#' + section.id} aria-label=${'Go to ' + section.title}>x</a>" +
        '</body></html>'
    );

    expectClean(result);
    expect(result.body).toContain('href="#top"');
    expect(result.body).toContain('aria-label="Go to Top"');
  });

  it('renders the presence-not-value example', () => {
    const result = render(
      '<html :isOpen=${false} :canSubmit=${false}><body>' +
        '<sl-dialog :attr-open=${isOpen}>x</sl-dialog>' +
        '<button :attr-disabled=${!canSubmit}>Send</button>' +
        '<input :attr-required>' +
        '</body></html>'
    );

    expectClean(result);
    expect(result.body).not.toContain('open');
    expect(result.body).toContain('disabled=""');
    expect(result.body).toContain('required=""');
  });

  it('removes an attribute whose expression is null', () => {
    const result = render(
      '<html :count=${0}><body>' +
        "<b title=${count > 0 ? 'yes' : null}>x</b>" +
        '</body></html>'
    );

    expectClean(result);
    expect(result.body).not.toContain('title');
  });
});

describe('docs/reference/syntax.md', () => {
  // the table under "Attribute values and quoting": quoting doesn't decide
  // the type, filling the value on its own does
  function compile(html: string) {
    const page = new Page(parse(html, 'docs.html'));
    stage1load(page);
    stage2validate(page);
    stage3qualify(page);
    stage4resolve(page);
    stage7generate(page);
    return page;
  }

  function valuesOf(html: string) {
    const page = compile(html);
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    const ctx = new WebContext({
      root: new Function(`return (${page.propsString});`)(),
      doc: page.source.doc,
      server: true,
      onError: e => {
        throw new Error(e.message);
      },
    }).refresh();
    return ctx.root.proxy;
  }

  it('keeps the type of an expression that fills the value, quoted or not', () => {
    const v = valuesOf(
      '<html :bare=${{ a: 1 }} :dq="${{ a: 1 }}" :sq=\'${{ a: 1 }}\'' +
        ' :num=${42} :dqNum="${42}"></html>'
    );
    expect(v['bare']).toStrictEqual({ a: 1 });
    expect(v['dq']).toStrictEqual({ a: 1 });
    expect(v['sq']).toStrictEqual({ a: 1 });
    expect(v['num']).toBe(42);
    expect(v['dqNum']).toBe(42);
  });

  it('interpolates to a string once anything else is in the value', () => {
    const v = valuesOf(
      '<html :mixed="n=${1}" :two="${1}${2}" :spaced=" ${1}"' +
        ' :plain="literal"></html>'
    );
    expect(v['mixed']).toBe('n=1');
    expect(v['two']).toBe('12');
    // whitespace is literal text like any other
    expect(v['spaced']).toBe(' 1');
    expect(v['plain']).toBe('literal');
  });

  it('takes a literal arrow for callbacks, and nothing else', () => {
    // the yes/error block under the binding table. Covered per-rule in
    // stage2-validate.test.ts against hand-built values; this checks the
    // documented markup itself, including the lifecycle families
    const ok = (body: string) =>
      compile(`<html :count=\${0} :handler=\${() => 1}><body>${body}</body></html>`)
        .errors.map(e => e.msg);

    expect(ok('<b :on-click=${() => count++}>x</b>')).toStrictEqual([]);
    expect(ok('<b :on-click=${async () => { await count; }}>x</b>')).toStrictEqual([]);
    expect(ok('<b :did-init=${() => count++}>x</b>')).toStrictEqual([]);

    for (const bad of [
      '<b :on-click=${handler}>x</b>',
      '<b :on-click=${function () {}}>x</b>',
      '<b :did-init=${handler}>x</b>',
      '<b :will-dispose=${handler}>x</b>',
    ]) {
      expect(ok(bad).join(' ')).toContain('must be an arrow function');
    }

    // and the wider rule: no classic function anywhere inside any expression
    expect(ok('<b :x=${() => { const f = function () {}; return f; }}>x</b>').join(' '))
      .toContain('Nested functions must be arrow functions');
  });

  it('passes an array through :prop- when the expression fills the value', () => {
    const page = compile(
      '<html :items=${["a", "b"]}><body>' +
        '<sl-select :prop-options="${items}" :prop-label="one of ${items.length}">' +
        '</sl-select></body></html>'
    );
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    const ctx = new WebContext({
      root: new Function(`return (${page.propsString});`)(),
      doc: page.source.doc,
      onError: e => {
        throw new Error(e.message);
      },
    }).refresh();
    const select = ctx.root.children[1].children[0] as any;
    expect(select.dom.options).toStrictEqual(['a', 'b']);
    expect(select.dom.label).toBe('one of 2');
  });
});

describe('docs/concepts/scopes.md', () => {
  it('renders the $id anchoring example', () => {
    const result = render(
      '<html><head><:define tag="bs-nav:nav" :_id=${$id}>' +
        '<button data-bs-target="#nav-${_id}" aria-controls="nav-${_id}">t</button>' +
        '<div class="collapse" id="nav-${_id}">c</div>' +
        '</:define></head><body><bs-nav /><bs-nav /></body></html>'
    );

    expectClean(result);
    const ids = [...result.body.matchAll(/id="(nav-[^"]*)"/g)].map(m => m[1]);
    // one id per instance, and the three references within an instance agree
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(result.body).toContain(`data-bs-target="#${id}"`);
      expect(result.body).toContain(`aria-controls="${id}"`);
    }
  });
});

describe('docs/concepts/modules-and-components.md', () => {
  const CARD =
    '<:define tag="my-card:div" class="card" :title="Untitled">' +
    '<h5>${title}</h5></:define>';

  it('renders the parameters-and-defaults example', () => {
    const result = render(
      `<html :post=\${{ name: "From data" }}><head>${CARD}</head><body>` +
        '<my-card /><my-card :title="Hello" /><my-card :title=${post.name} />' +
        '</body></html>'
    );

    expectClean(result);
    expect(result.body).toContain('Untitled');
    expect(result.body).toContain('Hello');
    expect(result.body).toContain('From data');
  });

  it('renders the slot example, with and without content', () => {
    const result = render(
      '<html><head><:define tag="my-card:div" class="card">' +
        '<div class="body"><:slot>Nothing here yet.</:slot></div>' +
        '</:define></head><body>' +
        '<my-card><p>Anything you like.</p></my-card><my-card />' +
        '</body></html>'
    );

    expectClean(result);
    expect(result.body).toContain('<div class="body"><p>Anything you like.</p></div>');
    expect(result.body).toContain('<div class="body">Nothing here yet.</div>');
  });

  it('renders the named-slot example', () => {
    const result = render(
      '<html><head><:define tag="my-panel:section" :title="T">' +
        '<header><:slot name="header">${title}</:slot></header>' +
        '<div class="body"><:slot /></div>' +
        '</:define></head><body>' +
        '<my-panel><h2 :slot="header">Custom heading</h2>' +
        'Everything else fills the unnamed slot.</my-panel>' +
        '</body></html>'
    );

    expectClean(result);
    expect(result.body).toContain('<header><h2>Custom heading</h2></header>');
    expect(result.body).toContain('Everything else fills the unnamed slot.');
  });

  it('renders the composing example', () => {
    const result = render(
      '<html :posts=${[{ title: "One", tag: "a" }, { title: "Two", tag: "b" }]}>' +
        '<head><:define tag="my-badge:span" class="badge" :label="">${label}</:define>' +
        '<:define tag="my-card:div" class="card" :title="Untitled">' +
        '<h5>${title}</h5><div class="body"><:slot /></div></:define>' +
        '</head><body><ul><li :for-each=${posts}>' +
        '<my-card :title=${data.title}><my-badge :label=${data.tag} /></my-card>' +
        '</li></ul></body></html>'
    );

    expectClean(result);
    // one card per post, each with its own badge, all reading the loop's item
    const live = result.body.slice(result.body.indexOf('</template>'));
    expect(live).toContain('One');
    expect(live).toContain('Two');
    expect(live).toContain('<span class="badge">a</span>');
    expect(live).toContain('<span class="badge">b</span>');
  });

  it('renders the resolves-where-written example', () => {
    const result = render(
      '<html :label=${"page"}><head>' +
        '<:define tag="my-box:div" :label=${"definition"}><:slot /></:define>' +
        '</head><body><my-box>${label}</my-box></body></html>'
    );

    expectClean(result);
    expect(result.body).toContain('page');
    expect(result.body).not.toContain('definition');
  });
});

describe('docs/concepts/replication.md', () => {
  it('renders the :for-key example', () => {
    const result = render(
      '<html :rows=${[{ id: "a", label: "One" }, { id: "b", label: "Two" }]}>' +
        '<body><ul><li :for-each=${rows} :for-key=${data.id}>' +
        '<input> ${data.label}' +
        '</li></ul></body></html>'
    );

    expectClean(result);
    // one replica per row, each reading its own item -- a key changes which
    // replica an item belongs to, never what gets rendered
    const live = result.body.slice(result.body.indexOf('</template>'));
    expect(live).toContain('One');
    expect(live).toContain('Two');
  });
});
