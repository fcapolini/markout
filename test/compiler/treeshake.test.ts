import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Compiler } from '../../src/compiler';

/**
 * Stage 6 drops `<:define>`s no usage site was found for.
 *
 * A kit is imported whole and a page uses a fraction of it, so the rest
 * would ship their stencils — the `<template>`s holding markup for tags
 * that appear nowhere. Only markup: a definition's scope was never in the
 * props to begin with, since stage7 filters definitions out.
 */
let docroot: string;
let seq = 0;

const LIB = `<lib>
  <:define tag="x-used:div" class="used-marker"><:slot /></:define>
  <:define tag="x-unused:div" class="unused-marker"><:slot /></:define>
  <:define tag="x-viaother:div" class="viaother-marker"><:slot /></:define>
  <:define tag="x-wrapper:div" class="wrapper-marker"><x-viaother>w</x-viaother></:define>
</lib>`;

beforeAll(() => {
  docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-shake-'));
  fs.writeFileSync(path.join(docroot, 'lib.htm'), LIB);
});
afterAll(() => fs.rmSync(docroot, { recursive: true, force: true }));

async function build(body: string) {
  const name = `p${seq++}.html`;
  fs.writeFileSync(
    path.join(docroot, name),
    `<html><head><:import src="/lib.htm" /></head><body>${body}</body></html>`
  );
  const page = await new Compiler({ docroot }).compile(`/${name}`);
  expect(page.errors.map(e => e.msg)).toStrictEqual([]);
  return { page, markup: page.source.doc.toString() };
}

describe('stage6-treeshake', () => {
  it('keeps a definition the page uses', async () => {
    const { markup } = await build('<x-used>hi</x-used>');
    expect(markup).toContain('used-marker');
  });

  it('drops one it does not', async () => {
    const { markup, page } = await build('<x-used>hi</x-used>');
    expect(markup).not.toContain('unused-marker');
    expect(page.customTags.has('x-unused')).toBe(false);
  });

  it('keeps a definition only another definition uses', async () => {
    // reached through `x-wrapper`'s body rather than from the page, and the
    // pass is deliberately blind to the difference: a tag is used if a usage
    // site was expanded for it anywhere
    const { markup } = await build('<x-wrapper />');
    expect(markup).toContain('wrapper-marker');
    expect(markup).toContain('viaother-marker');
  });

  it('keeps one reachable only through an unused definition', async () => {
    // the conservative half of the same rule. `x-viaother` is used by
    // `x-wrapper`'s body, `x-wrapper` is used by nobody -- so both could go,
    // and neither does. Removing them needs the usage graph rather than a
    // flat set, and getting that wrong deletes markup a page needs
    const { markup } = await build('<x-used>hi</x-used>');
    expect(markup).toContain('viaother-marker');
  });

  it('leaves a page that uses everything exactly as it was', async () => {
    const { markup } = await build(
      '<x-used>a</x-used><x-unused>b</x-unused><x-wrapper />'
    );
    for (const m of ['used-marker', 'unused-marker', 'wrapper-marker', 'viaother-marker']) {
      expect(markup).toContain(m);
    }
  });
});
