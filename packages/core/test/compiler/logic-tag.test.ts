import { describe, expect, it } from 'vitest';
import { Page } from '../../src/compiler/ir/Page';
import { parse } from '../../src/html/parser';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../src/compiler/stages/stage7-generate';
import { renderPage } from '../../src/render/render';
import { WebContext } from '../../src/runtime/web/web-context';
import { loadProps } from '../../src/render/props';

// `<:logic>` is a scope with no element. Everything else that declares
// values is markup that happens to carry them, so page-level state had to
// invent an element to live on -- one that is then real, and in the way of
// every `:first-child` and `* + *` on the page.

function compile(html: string) {
  const page = new Page(parse(html, 'test.html'));
  stage1load(page);
  page.errors.length || stage2validate(page);
  page.errors.length || stage3qualify(page);
  page.errors.length || stage4resolve(page);
  page.errors.length || stage7generate(page);
  return page;
}

async function render(html: string) {
  const page = compile(html);
  expect(page.errors.map(e => e.msg)).toStrictEqual([]);
  await renderPage(page);
  return page.source.doc
    .toString()
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/ data-markout="[^"]*"/g, '')
    .replace(/<!---[^>]*-->/g, '');
}

const BOX = '<:define tag="my-box:div"><:slot /></:define>';

describe('<:logic>', () => {
  it('declares values and leaves no element behind', async () => {
    const html = await render(
      '<html><body><:logic :aka="app" :n=${21} :double=${n * 2} />' +
        '<i>${app.double}</i></body></html>'
    );
    expect(html).toContain('<i>42</i>');
    // the point of the whole construct: nothing of it reaches the document
    expect(html).not.toContain('logic');
    expect(html).toMatch(/<body[^>]*><i>42<\/i><\/body>/);
  });

  it('does not need a name', async () => {
    // its values are then reachable from nowhere, which is not useless:
    // `:did-init` and `:handle-` declare behaviour rather than data, and a
    // block that starts a timer has no reason to be referred to
    const page = compile(
      '<html><body><:logic :_seen=${0} :did-init=${() => undefined} /><p>hi</p></body></html>'
    );
    expect(page.errors).toStrictEqual([]);
  });

  it('is reactive like any other scope', async () => {
    const html = await render(
      '<html><body :m=${2}><:logic :aka="app" :n=${m * 10} />' +
        '<i>${app.n}</i></body></html>'
    );
    expect(html).toContain('<i>20</i>');
  });

  describe('refuses what needs an element', () => {
    const cases: [string, string, RegExp][] = [
      ['a class', ':class-x=${true}', /":class-x" has a class to put it on/],
      ['a style', ':style-color=${"red"}', /":style-color" has a style to put it on/],
      ['a handler', ':on-click=${() => 1}', /":on-click" has an element to listen to/],
      [':for-each', ':for-each=${[1, 2]}', /nothing to replicate/],
      [':for-data', ':for-data=${1}', /nothing to show or hide/],
      [':if', ':if=${true}', /nothing to show or hide/],
      [':slot', ':slot="x"', /no markup to put in a slot/],
    ];
    for (const [what, attr, message] of cases) {
      it(what, () => {
        const page = compile(`<html><body><:logic :aka="a" ${attr} /></body></html>`);
        expect(page.errors.map(e => e.msg).join()).toMatch(message);
      });
    }

    it('a plain attribute', () => {
      const page = compile('<html><body><:logic class="x" :aka="a" /></body></html>');
      expect(page.errors.map(e => e.msg).join()).toMatch(/plain attribute "class" has nowhere to go/);
    });

    it('content', () => {
      const page = compile('<html><body><:logic :aka="a"><b>no</b></:logic></body></html>');
      expect(page.errors.map(e => e.msg).join()).toMatch(/values, not markup/);
    });
  });

  describe('refuses to be declared more than once', () => {
    // each of these turns a declaration that reads as one-per-page into
    // one-per-item, one-per-instance, or one that comes and goes -- and a
    // timer started per row is not something to find out about at runtime
    const cases: [string, string, RegExp][] = [
      [
        'inside a :for-each',
        '<html><body><div :for-each=${[1, 2]}><:logic :aka="a" :n=${1} /></div></body></html>',
        /once per item/,
      ],
      [
        'inside a :for-data',
        '<html><body><div :for-data=${1}><:logic :aka="a" :n=${1} /></div></body></html>',
        /take it away again/,
      ],
      [
        'inside an :if',
        '<html><body><div :if=${true}><:logic :aka="a" :n=${1} /></div></body></html>',
        /take it away again/,
      ],
      [
        'inside a <:define>',
        '<html><head><:define tag="my-card:div"><:logic :aka="a" :n=${1} /></:define></head>' +
          '<body><my-card /></body></html>',
        /once per instance/,
      ],
      [
        'inside a custom tag',
        `<html><head>${BOX}</head><body><my-box><:logic :aka="a" :n=${1} /></my-box></body></html>`,
        /belong to the call site/,
      ],
    ];
    for (const [what, html, message] of cases) {
      it(what, () => {
        expect(compile(html).errors.map(e => e.msg).join()).toMatch(message);
      });
    }
  });
});

describe('<:define tag="x:logic">', () => {
  // the same construct one level up: `<:logic>` is a scope with no element,
  // this is a tag whose instances are. std-data was the case that asked for
  // it -- a datasource is a source, not a sight, and was paying for a
  // `<span hidden>` per usage to say so
  const SRC = '<:define tag="my-src:logic" ::n=${1} ::doubled=${n * 2} />';

  it('instantiates, and leaves nothing in the page', async () => {
    const html = await render(
      `<html><head>${SRC}</head><body><my-src :aka="a" ::n=\${21} />` +
        '<i>${a.doubled}</i></body></html>'
    );
    expect(html).toContain('42');
    expect(html).not.toContain('<my-src');
    // no stencil either: there is nothing to stamp instances out of
    expect(html).not.toContain('<template');
  });

  it('gives each instance its own values', async () => {
    const html = await render(
      `<html><head>${SRC}</head><body>` +
        '<my-src :aka="a" ::n=${1} /><my-src :aka="b" ::n=${5} />' +
        '<i>${a.doubled}/${b.doubled}</i></body></html>'
    );
    expect(html).toContain('2/10');
  });

  it('replicates under :for-each', async () => {
    // the case worth writing on purpose, because replication goes through
    // DOM cloning and these instances have no DOM. Nothing in the repo
    // exercises it, so without this it would ship untested
    const page = compile(
      `<html><head>${SRC}</head><body>` +
        '<my-src :for-each=${[1, 2, 3]} :for-as="k" ::n=${k * 10} /></body></html>'
    );
    expect(page.errors).toStrictEqual([]);
    await renderPage(page);
    const ctx = new WebContext({
      ...loadProps(page.props!),
      doc: page.source.doc,
      server: true,
    }).refresh() as any;
    const hosts: any[] = [];
    const walk = (s: any) => { s.clones?.length && hosts.push(s); s.children.forEach(walk); };
    walk(ctx.root);
    expect(hosts).toHaveLength(1);
    expect(hosts[0].clones.map((c: any) => c.proxy.doubled)).toStrictEqual([20, 40, 60]);
    expect(hosts[0].clones.every((c: any) => !c.dom)).toBe(true);
  });

  it('is dropped whole when unused', async () => {
    const html = await render(`<html><head>${SRC}</head><body><p>none</p></body></html>`);
    expect(html).not.toContain('template');
    expect(html).toContain('<p>none</p>');
  });

  it('refuses content and anything needing an element', () => {
    expect(
      compile('<html><head><:define tag="my-src:logic"><b>x</b></:define></head>' +
        '<body><my-src /></body></html>').errors.map(e => e.msg).join()
    ).toMatch(/values, not markup/);
    expect(
      compile('<html><head><:define tag="my-src:logic" :class-x=${true} /></head>' +
        '<body><my-src /></body></html>').errors.map(e => e.msg).join()
    ).toMatch(/":class-x" has a class to put it on/);
  });

  it('does not inherit <:logic>\'s placement rules', () => {
    // a `<:logic>` is refused inside a :for-each because it is a singleton
    // declaration that would silently become one per item. An INSTANCE is
    // written deliberately, so one per item is exactly what was asked for
    const page = compile(
      `<html><head>${SRC}</head><body><div :for-each=\${[1, 2]}>` +
        '<my-src ::n=${3} /></div></body></html>'
    );
    expect(page.errors).toStrictEqual([]);
  });
});
