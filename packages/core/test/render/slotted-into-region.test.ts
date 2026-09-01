import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/render/render';

/**
 * A component written inside a component whose slot sits in a region.
 *
 * The caller's markup is moved into the element holding the `<:slot/>`, so
 * when that element is a region the markup lands INSIDE it. The scope has to
 * land there too: parented past the region, an instance is bound to DOM the
 * region owns and never shows, and it renders nothing while reporting
 * nothing -- the whole component silently missing from the page.
 *
 * Plain markup was never affected, and neither was an instance carrying
 * `:aka`, which took a different path through the same function. So the
 * shape that failed is the ordinary one: a component dropped into a
 * `<std-route>`, or into anything else that wraps its slot in an `:if`.
 */

let docroot: string;
let seq = 0;
beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-slotreg-'));
});
afterAll(() => {
  fs.rmSync(docroot, { recursive: true, force: true });
});

const DEFS = [
  '<:define tag="my-box:div"><:slot/>!</:define>',
  '<:define tag="plain-wrap:div"><:slot/></:define>',
  '<:define tag="region-wrap:div" ::show=${true}><div :if=${show}><:slot/></div></:define>',
  '<:define tag="group-wrap:div"><:group :if=${true}><:slot/></:group></:define>',
  '<:define tag="named-wrap:div"><div :if=${true}><:slot name="a"/></div></:define>',
].join('\n');

async function render(body: string) {
  const name = `w${seq++}.html`;
  fs.writeFileSync(
    path.join(docroot, name),
    `<html><head>${DEFS}</head><body>${body}</body></html>`
  );
  const page = await new Compiler({ docroot }).compile(`/${name}`);
  const errors = [
    ...page.errors.map(e => e.msg),
    ...(await renderPage(page, { url: 'http://x.test/p' })).map(
      (e: any) => e.msg ?? e.message
    ),
  ];
  const out = (
    /<body[^>]*>([\s\S]*?)(<script|<\/body)/.exec(page.source.doc.toString())?.[1] ?? ''
  )
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<template[\s\S]*?<\/template>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { errors, out };
}

describe('a component slotted into a region', () => {
  it('renders, the same as one slotted anywhere else', async () => {
    expect(await render('<plain-wrap><my-box>Z</my-box></plain-wrap>')).toStrictEqual({
      errors: [],
      out: 'Z!',
    });
    expect(
      await render('<region-wrap ::show=${true}><my-box>Z</my-box></region-wrap>')
    ).toStrictEqual({ errors: [], out: 'Z!' });
  });

  it('renders inside a <:group> region too', async () => {
    expect(await render('<group-wrap><my-box>Z</my-box></group-wrap>')).toStrictEqual({
      errors: [],
      out: 'Z!',
    });
  });

  it('renders into a named slot inside a region', async () => {
    expect(
      await render('<named-wrap><my-box :slot="a">Z</my-box></named-wrap>')
    ).toStrictEqual({ errors: [], out: 'Z!' });
  });

  it('still answers to the region, which is the point of it being inside one', async () => {
    expect(
      await render('<region-wrap ::show=${false}><my-box>Z</my-box></region-wrap>')
    ).toStrictEqual({ errors: [], out: '' });
  });

  it('renders when the instance is named, as it always did', async () => {
    expect(
      await render('<region-wrap ::show=${true}><my-box :aka="b">Z</my-box></region-wrap>')
    ).toStrictEqual({ errors: [], out: 'Z!' });
  });

  it('nests, which is what a router inside a route needs', async () => {
    expect(
      await render(
        '<region-wrap ::show=${true}><region-wrap ::show=${true}>' +
          '<my-box>Z</my-box></region-wrap></region-wrap>'
      )
    ).toStrictEqual({ errors: [], out: 'Z!' });
  });
});
