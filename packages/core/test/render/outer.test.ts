import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/render/render';
import { loadProps } from '../../src/render/props';
import { WebContext } from '../../src/runtime/web/web-context';

/**
 * `$outer(tag)` — the nearest enclosing instance of a tag.
 *
 * A definition cannot see the instance enclosing it, so anything that
 * composes onto its container has to be told what it is already inside. The
 * parent alone will not do: an `:if` region, a `:for-each`, or a `<div>`
 * carrying a value each add a link, so the enclosing instance is reliably an
 * ancestor and never reliably the parent. Hence a walk.
 *
 * It is a call in the source and a plain dependency segment by the time
 * anything runs. A lookup performed per read would emit no dependency, so
 * the reader would answer once and never again — which is exactly the case
 * this exists for, a nested thing recomputing when what encloses it moves.
 */

let docroot: string;
let seq = 0;
beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-outer-'));
});
afterAll(() => {
  fs.rmSync(docroot, { recursive: true, force: true });
});

const DEFS = [
  // depth counted through whatever lies between: each asks the nearest one
  // above it and adds one, which is the whole of what nesting needs
  '<:define tag="my-level:div" ::depth=${($outer("my-level")?.depth ?? -1) + 1}',
  '  ::label="">[${label}@${depth}]<:slot/></:define>',
  '<:define tag="my-plain:div"><:slot/></:define>',
  '<:define tag="my-gate:div" ::on=${true}><div :if=${on}><:slot/></div></:define>',
  '<:define tag="my-probe:div">' +
    '<i>probe=${$outer("my-level")?.label ?? "none"}</i></:define>',
].join('\n');

async function render(body: string) {
  const name = `o${seq++}.html`;
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
  return { errors, out, page };
}

describe('$outer(tag)', () => {
  it('finds nothing when there is nothing to find', async () => {
    const r = await render('<my-probe/><my-level ::label="a"/>');
    expect(r.errors).toStrictEqual([]);
    expect(r.out).toBe('probe=none [a@0]');
  });

  it('finds the enclosing instance of that tag', async () => {
    const r = await render('<my-level ::label="a"><my-probe/></my-level>');
    expect([r.errors, r.out]).toStrictEqual([[], '[a@0] probe=a']);
  });

  it('excludes itself, so a definition finds the one outside it', async () => {
    // `my-level` asking for `my-level` must not answer with itself, or its
    // own default would be defined in terms of the instance it is defaulting
    const r = await render(
      '<my-level ::label="a"><my-level ::label="b"><my-level ::label="c"/></my-level></my-level>'
    );
    expect([r.errors, r.out]).toStrictEqual([[], '[a@0] [b@1] [c@2]']);
  });

  it('walks past whatever lies between, which is why it is a walk', async () => {
    // a plain component, a region, and an element carrying a value each add
    // a link -- the enclosing instance is an ancestor, never reliably a parent
    const r = await render(
      '<my-level ::label="a"><my-plain><div :n=${1}><my-gate>' +
        '<my-level ::label="b"><my-probe/></my-level>' +
        '</my-gate></div></my-plain></my-level>'
    );
    expect([r.errors, r.out]).toStrictEqual([[], '[a@0] [b@1] probe=b']);
  });

  it('skips instances of other tags on the way up', async () => {
    const r = await render(
      '<my-level ::label="a"><my-plain><my-probe/></my-plain></my-level>'
    );
    expect([r.errors, r.out]).toStrictEqual([[], '[a@0] probe=a']);
  });

  it('refuses a tag it cannot know, rather than answering once', async () => {
    const r = await render('<my-level ::label=${$outer(someTag).label}/>');
    expect(r.errors.join(' ')).toContain('takes one tag name, written out');
  });

  it('recomputes when what it found moves, which a per-read lookup could not', async () => {
    const name = `o${seq++}.html`;
    fs.writeFileSync(
      path.join(docroot, name),
      `<html><head>${DEFS}</head><body>` +
        '<my-level ::label=${$url.search.replace("?", "") || "a"}>' +
        '<my-plain><my-probe/></my-plain></my-level>' +
        '</body></html>'
    );
    const page = await new Compiler({ docroot }).compile(`/${name}`);
    expect(page.errors.map(e => e.msg)).toStrictEqual([]);
    const url = 'http://x.test/p?a';
    expect(await renderPage(page, { url })).toStrictEqual([]);
    const window = new Window({ url });
    window.document.write(page.source.doc.toString());
    const errors: string[] = [];
    const ctx = new WebContext({
      ...loadProps(page.clientProps ?? page.props!),
      doc: window.document as any,
      url,
      onError: e => errors.push(e.message),
    }).refresh();
    const probe = () => (window.document.querySelector('i') as any).textContent;
    expect(probe()).toBe('probe=a');
    ctx.adoptUrl('http://x.test/p?b');
    expect(probe()).toBe('probe=b');
    expect(errors).toStrictEqual([]);
  });
});
