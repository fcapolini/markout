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
  <style :when-used="x-used">.for-used { color: red }</style>
  <style :when-used="x-unused">.for-unused { color: blue }</style>
  <style :when-used="x-used x-unused">.for-either { color: teal }</style>
  <style>.unconditional { color: green }</style>
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

interface Extra {
  head?: string;
  html?: string;
  [file: string]: string | undefined;
}

async function build(body: string, extra: Extra = {}) {
  const name = `p${seq++}.html`;
  for (const [file, content] of Object.entries(extra)) {
    if (file === 'head' || file === 'html') continue;
    fs.writeFileSync(path.join(docroot, file), content!);
  }
  fs.writeFileSync(
    path.join(docroot, name),
    `<html${extra.html ?? ''}><head><:import src="/lib.htm" />${extra.head ?? ''}</head>` +
      `<body>${body}</body></html>`
  );
  const page = await new Compiler({ docroot }).compile(`/${name}`);
  const errors = page.errors.map(e => e.msg);
  return { page, errors, markup: page.source.doc.toString() };
}

/** renders and reports, for the cases that must not leave a dangling binding */
async function renderErrors(page: Awaited<ReturnType<typeof build>>['page']) {
  const { renderPage } = await import('../../src/render/render');
  return (await renderPage(page)).map(e => `${e.phase}: ${e.message}`);
}

describe(':when-used', () => {
  it('keeps an asset while a tag it names survives', async () => {
    const { markup } = await build('<x-used>hi</x-used>');
    expect(markup).toContain('.for-used');
  });

  it('drops one whose tags all went', async () => {
    const { markup } = await build('<x-used>hi</x-used>');
    expect(markup).not.toContain('.for-unused');
  });

  it('needs only one of the tags it names', async () => {
    const { markup } = await build('<x-used>hi</x-used>');
    expect(markup).toContain('.for-either');
  });

  it('leaves an unmarked asset alone, whatever happens to the components', async () => {
    // opting in is the whole point: a stylesheet sitting next to some
    // definitions is not necessarily THEIR stylesheet
    const { markup } = await build('<x-used>hi</x-used>');
    expect(markup).toContain('.unconditional');
  });

  it('costs the element no scope, so it weighs nothing at runtime', async () => {
    const { markup, page } = await build('<x-used>hi</x-used>');
    expect(markup).not.toMatch(/<style data-markout/);
    expect(page.props?.data ?? '').not.toContain('when-used');
    expect(markup).not.toContain('when-used');
  });

  it('takes the value and its binding with it when it goes', async () => {
    // a dropped stylesheet holding an interpolation leaves a value whose
    // node is gone; emitting it would bind to markup the page no longer has
    const { page, markup, errors } = await build('<x-used>hi</x-used>', {
      'lib2.htm':
        '<lib><style :when-used="x-gone">.g { color: ${accent} }</style>' +
        '<:define tag="x-gone:div">g</:define></lib>',
      head: '<:import src="/lib2.htm" />',
      html: ' :accent="red"',
    });
    expect(errors).toStrictEqual([]);
    expect(markup).not.toContain('.g {');
    expect(await renderErrors(page)).toStrictEqual([]);
  });

  it('refuses a tag no <:define> declares', async () => {
    const { errors } = await build('<x-used>hi</x-used>', {
      'lib3.htm': '<lib><style :when-used="x-typo">.t {}</style></lib>',
      head: '<:import src="/lib3.htm" />',
    });
    expect(errors.join()).toMatch(/names "x-typo", which no <:DEFINE> declares/i);
  });

  it('refuses an expression, and an empty list', async () => {
    const a = await build('<x-used>hi</x-used>', {
      'lib4.htm': '<lib><style :when-used=${"x-used"}>.e {}</style></lib>',
      head: '<:import src="/lib4.htm" />',
    });
    expect(a.errors.join()).toMatch(/takes a literal/);
    const b = await build('<x-used>hi</x-used>', {
      'lib5.htm': '<lib><style :when-used="">.e {}</style></lib>',
      head: '<:import src="/lib5.htm" />',
    });
    expect(b.errors.join()).toMatch(/needs at least one tag name/);
  });
});

describe('stage6-treeshake', () => {
  it('keeps a definition the page uses', async () => {
    const { markup, errors } = await build('<x-used>hi</x-used>');
    expect(errors).toStrictEqual([]);
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
