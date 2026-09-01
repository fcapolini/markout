import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';
import { renderPage } from '../../src/render/render';

/**
 * A render settles, rather than answering with whatever it happened to see.
 *
 * A scope's own values are evaluated before its children exist, so a child
 * that writes to its `$host` while rendering writes after every one of the
 * parent's own values has already run. Those readers are marked dirty, but
 * nothing walked them again -- so the pass ended with the write landed, its
 * direct readers current, and everything derived from it stale.
 *
 * That is not merely stale, it is inconsistent: two readers of one value
 * could disagree inside a single render, and a component that registered
 * itself with its parent -- the shape every "collection of children" has --
 * produced a page that contradicted itself on first paint and corrected
 * itself only on the next navigation.
 */

let docroot: string;
let seq = 0;
beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-settle-'));
});
afterAll(() => {
  fs.rmSync(docroot, { recursive: true, force: true });
});

async function render(head: string, body: string) {
  const name = `s${seq++}.html`;
  fs.writeFileSync(
    path.join(docroot, name),
    `<html><head>${head}</head><body>${body}</body></html>`
  );
  const page = await new Compiler({ docroot }).compile(`/${name}`);
  const errors = [
    ...page.errors.map(e => e.msg),
    ...(await renderPage(page, { url: 'http://x.test/p' })).map(
      (e: any) => e.msg ?? e.message
    ),
  ];
  return {
    errors,
    out: (/<body[^>]*>([\s\S]*?)(<script|<\/body)/.exec(page.source.doc.toString())?.[1] ?? '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<template[\s\S]*?<\/template>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  };
}

/**
 * A parent value written by a slotted child, read three ways: the parent's
 * own markup before the slot, after it, and a child through `$host`. The
 * writer is last, so every reader ran before the write.
 */
const HOST_WRITE = [
  '<:define tag="p-t:div" :_n=${[]}',
  '  ::add=${(n) => { _n.includes(n) || (_n = [..._n, n]); }}',
  '  ::page=${_n.includes("x") ? "x" : "idx"}>',
  '  <s>own=${page}</s>',
  '  <:slot/>',
  '  <b>late=${page} n=[${_n.join(",")}]</b>',
  '</:define>',
  '<:define tag="p-r:div" :_seen=${$host.page}><u>child=${_seen}</u></:define>',
  '<:define tag="p-w:logic" ::n="" :_x=${$host.add(n)} />',
].join('\n');

describe('a render that is written to while it runs', () => {
  it('carries the write to everything derived from it', async () => {
    const r = await render(HOST_WRITE, '<p-t><p-r/><p-w ::n="x"/></p-t>');
    expect(r.out).toBe('own=x child=x late=x n=[x]');
    expect(r.errors).toStrictEqual([]);
  });

  it('reaches the same answer whichever order the readers are in', async () => {
    // the writer first rather than last: this order always worked, and the
    // point is that the other one now agrees with it rather than that this
    // one still does
    const r = await render(HOST_WRITE, '<p-t><p-w ::n="x"/><p-r/></p-t>');
    expect(r.out).toBe('own=x child=x late=x n=[x]');
    expect(r.errors).toStrictEqual([]);
  });

  it('leaves a render nobody wrote to alone', async () => {
    const r = await render(HOST_WRITE, '<p-t><p-r/></p-t>');
    expect(r.out).toBe('own=idx child=idx late=idx n=[]');
    expect(r.errors).toStrictEqual([]);
  });

  it('says so when a page never settles, instead of hanging', async () => {
    // an array literal assigned on every evaluation: never equal to the last
    // one, so every pass writes again
    const never = [
      '<:define tag="p-x:div" :_n=${[]}',
      '  ::add=${() => { _n = [..._n, 1]; }}>',
      '  <:slot/>',
      '  <b>${_n.length}</b>',
      '</:define>',
      '<:define tag="p-y:logic" :_x=${$host.add()} />',
    ].join('\n');
    const r = await render(never, '<p-x><p-y/></p-x>');
    expect(r.errors.join(' ')).toContain('does not settle');
  });
});
