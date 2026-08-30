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

  it('drops one reachable only through an unused definition', async () => {
    // `x-viaother` is used by `x-wrapper`'s body and `x-wrapper` is used by
    // nobody, so neither is reachable from the page and both go. The flat
    // set kept the inner one on the strength of a mention inside the very
    // definition this pass had just deleted
    const { markup } = await build('<x-used>hi</x-used>');
    expect(markup).not.toContain('viaother-marker');
    expect(markup).not.toContain('wrapper-marker');
  });

  it('keeps one reached through a definition that is itself used', async () => {
    // the edge that must NOT be cut: the page writes no <x-viaother>, and it
    // survives because <x-wrapper> is written and its body reaches it
    const { markup } = await build('<x-wrapper />');
    expect(markup).toContain('wrapper-marker');
    expect(markup).toContain('viaother-marker');
  });

  it('drops the stencil of an instance written inside a definition that went', async () => {
    // `x-wrapper` holds `<x-viaother>w</x-viaother>`, and an instance given
    // content is stamped from a stencil of its own -- appended to <head>
    // beside the definitions' rather than nested inside the one it was
    // written in. So removing the wrapper's stencil left that instance's
    // behind, and nothing could ever stamp it: an instance stencil is
    // reachable only through the `template` its scope's props name, and the
    // scope went with the definition
    const { markup, page } = await build('<x-used>hi</x-used>');
    // the wrapper is unreachable, and so now is the definition it reached
    expect(markup).not.toContain('viaother-marker');
    // ...and the instance written inside it leaves no stencil behind
    expect(markup).not.toContain('>w<');
    const props = page.props!.data;
    const stencils = [...markup.matchAll(/data-markout="(s\d+t)"/g)].map(m => m[1]);
    // every instance stencil still standing is named by a scope that can use it
    expect(stencils.filter(id => !props.includes(`"${id}"`))).toStrictEqual([]);
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

/**
 * A `<style>` written as a direct child of a `<:define>` is that
 * component's — structurally, so unlike `:when-used` there is no claim for
 * an author to state and none for them to get wrong. Stage 1 lifts it out
 * to sit just before the definition's stencil, once, and stage 6 drops it
 * with the definition.
 */
describe('a definition stylesheet', () => {
  const STYLED = [
    '<lib>',
    '  <:define tag="y-card:div" class="cc" ::heading=${\'\'}>',
    '    <style>.cc { color: seagreen }</style>',
    '    <h3>${heading}</h3><:slot />',
    '  </:define>',
    '  <:define tag="y-plain:div">plain</:define>',
    '</lib>',
  ].join('\n');
  const styled = { 'styled.htm': STYLED, head: '<:import src="/styled.htm" />' };

  it('ships once however many instances there are', async () => {
    const { markup, errors } = await build(
      '<y-card ::heading="a">A</y-card><y-card ::heading="b">B</y-card>' +
        '<y-card ::heading="c">C</y-card>',
      styled
    );
    expect(errors).toStrictEqual([]);
    // one, not four: the definition's stencil held a copy and so did each
    // instance's, which is the cost that made the pattern unwritable
    expect(markup.split('seagreen').length - 1).toBe(1);
  });

  it('sits before its stencil, so the page still overrides it', async () => {
    const { markup } = await build('<y-card>A</y-card>', styled);
    const sheet = markup.indexOf('seagreen');
    expect(sheet).toBeGreaterThan(-1);
    // its OWN stencil: the shared lib above contributes earlier ones
    expect(sheet).toBeLessThan(markup.indexOf('<div class="cc"'));
    expect(sheet).toBeLessThan(markup.indexOf('</head>'));
  });

  it('goes when its definition does', async () => {
    const { markup, errors } = await build('<y-plain />', styled);
    expect(errors).toStrictEqual([]);
    expect(markup).not.toContain('seagreen');
    expect(markup).not.toContain('y-card');
  });

  it('is left alone when it interpolates, having no "once" to hoist to', async () => {
    const REACTIVE = [
      '<lib><:define tag="y-hue:div" class="hh" ::hue=${\'red\'}>',
      '<style>.hh { color: ${hue} }</style><span>h</span>',
      '</:define></lib>',
    ].join('');
    const { markup, errors } = await build('<y-hue ::hue="crimson" />', {
      'reactive.htm': REACTIVE,
      head: '<:import src="/reactive.htm" />',
    });
    expect(errors).toStrictEqual([]);
    // still inside the stencil, still per instance: each one renders its own
    expect(markup).toMatch(/<template>[\s\S]*?<style>/);
  });

  it("is left alone when it is nested rather than the definition's own", async () => {
    const NESTED = [
      '<lib><:define tag="y-cond:div" ::on=${false}>',
      '<div :if=${on}><style>.deep { color: navy }</style></div>',
      '</:define></lib>',
    ].join('');
    const { markup, errors } = await build('<y-cond />', {
      'nested.htm': NESTED,
      head: '<:import src="/nested.htm" />',
    });
    expect(errors).toStrictEqual([]);
    // being inside the `:if` is the point; hoisting would answer a question
    // the author had already answered differently
    expect(markup).toMatch(/<template>[\s\S]*?navy/);
  });

  it('is refused in a definition written in <body>', async () => {
    const { errors } = await build(
      '<:define tag="y-inline:div"><style>.z { color: red }</style>z</:define><y-inline />'
    );
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('written in <body> has nowhere to go');
  });
});

/**
 * A component's classes are global — nothing is rewritten or hashed — so a
 * page can wear `.cc` without ever writing `<y-card>`. Do both and the
 * definition's stylesheet is dropped out from under markup that stayed.
 * That is the one silent failure global naming can produce, so it is said
 * out loud, and only when it has actually happened.
 */
describe('a definition stylesheet the page borrowed from', () => {
  const BORROWED = [
    '<lib>',
    '  <:define tag="z-card:div" class="cc">',
    '    <style>.cc { color: seagreen } .cc-title { font-weight: 600 }</style>',
    '    <span class="cc-title">t</span>',
    '  </:define>',
    '  <:define tag="z-other:div">other</:define>',
    '</lib>',
  ].join('\n');
  const borrowed = { 'borrowed.htm': BORROWED, head: '<:import src="/borrowed.htm" />' };
  const warnings = (page: { errors: { type: string; msg: string }[] }) =>
    page.errors.filter(e => e.type === 'warning').map(e => e.msg);

  it('warns, naming every class that lost its rules', async () => {
    const { page } = await build('<z-other /><p class="cc cc-title">by hand</p>', borrowed);
    const said = warnings(page);
    expect(said.length).toBe(1);
    expect(said[0]).toContain('<z-card> is never used');
    expect(said[0]).toContain('"cc", "cc-title"');
  });

  it('says nothing when the page borrowed none of them', async () => {
    const { page } = await build('<z-other /><p class="unrelated">nothing</p>', borrowed);
    expect(warnings(page)).toStrictEqual([]);
  });

  it('says nothing when the definition survives', async () => {
    // the page wears `.cc` by hand AND writes the tag: nothing was lost, and
    // a lint that fires here is one people learn to skip
    const { page } = await build('<z-card /><p class="cc">by hand</p>', borrowed);
    expect(warnings(page)).toStrictEqual([]);
  });

  it('sees a class a `:class-` toggle would have applied', async () => {
    const { page } = await build('<z-other /><p :class-cc=${true}>toggled</p>', borrowed);
    expect(warnings(page)[0]).toContain('"cc"');
  });

  it('does not read a class out of a declaration', async () => {
    // `url(logo.cc)` is not a selector; only the text before each `{` is read
    const URLY = '<lib><:define tag="z-bg:div" class="bg">' +
      '<style>.bg { background: url(logo.cc) }</style>x</:define>' +
      '<:define tag="z-x:div">x</:define></lib>';
    const { page } = await build('<z-x /><p class="cc">unrelated</p>', {
      'urly.htm': URLY,
      head: '<:import src="/urly.htm" />',
    });
    expect(warnings(page)).toStrictEqual([]);
  });
});
