import { describe, expect, it } from 'vitest';
import { Page } from '../src/compiler/ir/Page';
import { stage1load } from '../src/compiler/stages/stage1-load';
import { stage2validate } from '../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../src/compiler/stages/stage7-generate';
import { parse } from '../src/html/parser';
import { renderPage } from '../src/server/render';

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
