import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/render/render';
import { hydrate } from '../../src/render/hydrate';

/**
 * `<:group>` carrying a branch: one region over several nodes.
 *
 * Every other region in the language is one element, found after its marker
 * by the id it carries. A group has no element -- the tag is not markup and
 * an HTML parser would hand `<:group>` back as text -- so the region is
 * every node between a marker at each end, and showing and hiding move that
 * run rather than one node.
 *
 * Driven through a real DOM rather than asserted on the compiled markup,
 * because the half that can go wrong is the runtime's: the served page and
 * the hydrated page have to be the same page, and hiding has to empty
 * exactly the run and no more. See docs/design/group-regions.md.
 */
let docroot: string;
let seq = 0;
beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-groups-'));
});
afterAll(() => {
  fs.rmSync(docroot, { recursive: true, force: true });
});

/** compile, server-render, hydrate in a DOM, and report at each step */
async function mount(bodyAttrs: string, markup: string) {
  const name = `g${seq++}.html`;
  fs.writeFileSync(
    path.join(docroot, name),
    `<html><body ${bodyAttrs}>${markup}</body></html>`
  );
  const compiled = await new Compiler({ docroot }).compile(`/${name}`);
  expect(compiled.errors.map(e => e.msg)).toStrictEqual([]);
  expect(await renderPage(compiled)).toStrictEqual([]);
  const served = compiled.source.doc.toString();
  const window = new Window();
  window.document.write(served);
  const mounted = hydrate(compiled, { doc: window.document as any });
  const body = () =>
    (window.document.querySelector('body') as unknown as { innerHTML: string }).innerHTML
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<!---[^>]*-->/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  return {
    ssr: (/<body[^>]*>([\s\S]*?)<script type="application\/json"/.exec(served)?.[1] ?? '')
      .replace(/<!---[^>]*-->/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
    hydrated: body(),
    root: mounted.root as Record<string, any>,
    body,
    errors: () => mounted.errors.map(e => e.message),
  };
}

describe('a run of nodes under one condition', () => {
  it('serves it, hydrates without touching it, and hides it whole', async () => {
    const p = await mount(':ok=${true}', '<:group :if=${ok}><p>one</p><p>two</p></:group>');
    expect(p.ssr).toBe('<p>one</p><p>two</p>');
    // the page the browser ends up with is the page it was served
    expect(p.hydrated).toBe(p.ssr);

    p.root.body.ok = false;
    expect(p.body()).toBe('');
    p.root.body.ok = true;
    expect(p.body()).toBe('<p>one</p><p>two</p>');
    expect(p.errors()).toStrictEqual([]);
  });

  it('fills an empty region from its stencil when the condition turns', async () => {
    const p = await mount(':ok=${false}', '<:group :if=${ok}><p>one</p><p>two</p></:group>');
    expect(p.ssr).toBe('');
    p.root.body.ok = true;
    expect(p.body()).toBe('<p>one</p><p>two</p>');
  });

  it('binds the interpolations inside it, server-side and after', async () => {
    const p = await mount(
      ':ok=${true} :n=${1}',
      '<:group :if=${ok}><p>${n}</p>|${n}|</:group>'
    );
    expect(p.ssr).toBe('<p>1</p>|1|');
    p.root.body.n = 9;
    expect(p.body()).toBe('<p>9</p>|9|');
  });

  it('carries scopes of its own inside', async () => {
    const p = await mount(
      ':ok=${true} :n=${1}',
      '<:group :if=${ok}><p :class-hot=${n > 5}>${n}</p><i>x</i></:group>'
    );
    p.root.body.n = 9;
    expect(p.body()).toMatch(/class="hot"/);
    expect(p.body()).toMatch(/<i>x<\/i>/);
  });
});

describe('a group among the language it has to live with', () => {
  it('takes its place in an :else chain', async () => {
    const p = await mount(
      ':ok=${true}',
      '<:group :if=${ok}><p>A</p><p>B</p></:group><div :else>C</div>'
    );
    expect(p.ssr).toBe('<p>A</p><p>B</p>');
    p.root.body.ok = false;
    expect(p.body()).toBe('<div data-markout="s5">C</div>');
  });

  it('nests, and the inner one renders on the server too', async () => {
    const p = await mount(
      ':a=${true} :b=${true}',
      '<:group :if=${a}><p>x</p><:group :if=${b}><i>y</i><i>z</i></:group></:group>'
    );
    // the case that was broken while this was built: the inner region has
    // to find its own marker, which it cannot do through an element that
    // claims a scope of its own
    expect(p.ssr).toBe('<p>x</p><i>y</i><i>z</i>');
    expect(p.hydrated).toBe(p.ssr);
    p.root.body.b = false;
    expect(p.body()).toBe('<p>x</p>');
  });

  it('places a definition\'s slotted content with no wrapper element', async () => {
    // the case this feature is for: a component that shows the caller's
    // markup or not had to wrap it in an element to carry the `:if`, and
    // that element was a route level's worth of markup in router-kit
    fs.writeFileSync(
      path.join(docroot, 'kit.htm'),
      '<lib><:define tag="rt-route:div" ::matched=${false}>' +
        '<:group :if=${matched}><:slot /></:group>' +
        '</:define></lib>'
    );
    const name = `g${seq++}.html`;
    fs.writeFileSync(
      path.join(docroot, name),
      '<html><head><:import src="/kit.htm" /></head><body :on=${true}>' +
        '<rt-route ::matched=${on}><p>A</p><p>B</p></rt-route>' +
        '</body></html>'
    );
    const compiled = await new Compiler({ docroot }).compile(`/${name}`);
    expect(compiled.errors.map(e => e.msg)).toStrictEqual([]);
    expect(await renderPage(compiled)).toStrictEqual([]);
    const window = new Window();
    window.document.write(compiled.source.doc.toString());
    const mounted = hydrate(compiled, { doc: window.document as any });
    const body = () =>
      (window.document.querySelector('body') as unknown as { innerHTML: string }).innerHTML
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<!---[^>]*-->/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    // the only element is the component's own base tag
    expect(body()).toBe('<div data-markout="s7"><p>A</p><p>B</p></div>');
    (mounted.root as Record<string, any>).body.on = false;
    expect(body()).toBe('<div data-markout="s7"></div>');
  });

  it('gets a region per replica inside a :for-each', async () => {
    const p = await mount(
      ':rows=${[1, 2]} :ok=${true}',
      '<div :for-each=${rows} :for-as="r"><:group :if=${ok}><p>${r}a</p><p>${r}b</p></:group></div>'
    );
    expect(p.ssr).toMatch(/<p>1a<\/p><p>1b<\/p>/);
    expect(p.ssr).toMatch(/<p>2a<\/p><p>2b<\/p>/);
    p.root.body.ok = false;
    expect(p.body()).not.toMatch(/<p>/);
  });
});
