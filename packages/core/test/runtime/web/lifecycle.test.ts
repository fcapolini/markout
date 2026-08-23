import { describe, expect, it } from 'vitest';
import { Page } from '../../../src/compiler/ir/Page';
import { stage1load } from '../../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../../src/compiler/stages/stage7-generate';
import { parse } from '../../../src/html/parser';
import type { RuntimeError } from '../../../src/runtime/core/core-context';
import { WebContext } from '../../../src/runtime/web/web-context';
import { renderPage } from '../../../src/render/render';
import { loadProps } from '../../../src/render/props';

/**
 * The two lifecycle pairs, and the difference between them.
 *
 * `:did-init`/`:will-dispose` bracket the SCOPE; `:did-attach`/`:will-detach`
 * bracket its MARKUP. They would be one pair if markup could only come and
 * go with the scope that owns it -- but a `:for-data` region leaves the page
 * and comes back with its scope untouched, and that is exactly the case a
 * component wrapping a third-party plugin has to hear about, or it leaves
 * the plugin holding an element nobody can see.
 */
function build(html: string) {
  const page = new Page(parse(html, 'lifecycle.html'));
  stage1load(page);
  stage2validate(page);
  stage3qualify(page);
  stage4resolve(page);
  return page;
}

async function run(html: string) {
  const page = build(html);
  const errors = page.errors.map(e => e.msg);
  if (errors.length) return { errors, log: [], ctx: undefined, served: [] as string[] };
  stage7generate(page);
  const log: string[] = [];
  (globalThis as Record<string, unknown>).LIFECYCLE_LOG = log;
  // the served page first, to prove these do not run there
  const served = (await renderPage(page)).map((e: RuntimeError) => e.message);
  const atServe = [...log];
  log.length = 0;
  const ctx = new WebContext({
    ...loadProps(page.propsString),
    doc: page.source.doc,
    onError: (e: RuntimeError) => log.push(`ERROR ${e.message}`),
  }).refresh();
  return { errors, log, ctx, served, atServe };
}

const NOTE = (what: string) =>
  `\${() => { globalThis.LIFECYCLE_LOG.push("${what} " + tag); }}`;

const PROBE =
  '<:define tag="my-probe:i" :tag=${""} ' +
  `:did-init=${NOTE('init')} ` +
  `:did-attach=${NOTE('attach')} ` +
  `:will-detach=${NOTE('detach')} ` +
  `:will-dispose=${NOTE('dispose')}>x</:define>`;

describe('lifecycle callbacks', () => {
  it('announces a scope and its markup, in that order', async () => {
    const { errors, log } = await run(
      `<html><head>${PROBE}</head><body><my-probe :tag="a" /></body></html>`
    );
    expect(errors).toStrictEqual([]);
    expect(log).toStrictEqual(['init a', 'attach a']);
  });

  it('does not run any of them while serving', async () => {
    // browser-only, like `:handle-`: a served page has no view to drive, and
    // a timer started here would run on the server
    const { atServe } = await run(
      `<html><head>${PROBE}</head><body><my-probe :tag="a" /></body></html>`
    );
    expect(atServe).toStrictEqual([]);
  });

  it('detaches before disposing when a replica is dropped', async () => {
    const { ctx, log } = await run(
      `<html :rows=${'${["a", "b"]}'}><head>${PROBE}</head>` +
        '<body><my-probe :for-each=${rows} :tag=${data} /></body></html>'
    );
    expect(log).toStrictEqual(['init a', 'attach a', 'init b', 'attach b']);

    log.length = 0;
    ctx!.root.proxy.rows = ['a'];
    // its markup goes, then it does
    expect(log).toStrictEqual(['detach b', 'dispose b']);
  });

  it('detaches and attaches a :for-data region without ever disposing it', async () => {
    // the case the second pair exists for: the scope never goes away, so a
    // component that only had `:will-dispose` would never hear about this
    const { ctx, log } = await run(
      `<html :on=${'${true}'}><head>${PROBE}</head>` +
        '<body><div :for-data=${on}><my-probe :tag="r" /></div></body></html>'
    );
    expect(log).toStrictEqual(['init r', 'attach r']);

    log.length = 0;
    ctx!.root.proxy.on = null;
    expect(log).toStrictEqual(['detach r']);

    ctx!.root.proxy.on = true;
    // back, and not re-initialised: the scope was here the whole time
    expect(log).toStrictEqual(['detach r', 'attach r']);
  });

  it('says nothing at all for a stencil', async () => {
    // a `:for-each` host is a prototype, not a rendering. It evaluates none
    // of its values, and for the same reason reports none of its lifetime
    const { log } = await run(
      `<html><head>${PROBE}</head>` +
        '<body><my-probe :for-each=${[]} :tag="never" /></body></html>'
    );
    expect(log).toStrictEqual([]);
  });

  it('takes a subtree apart deepest first, and builds it parents first', async () => {
    const { ctx, log } = await run(
      '<html :on=${true}><head>' +
        '<:define tag="my-outer:div" :tag=${""} ' +
        `:did-attach=${NOTE('attach')} :will-detach=${NOTE('detach')}><:slot /></:define>` +
        '<:define tag="my-inner:i" :tag=${""} ' +
        `:did-attach=${NOTE('attach')} :will-detach=${NOTE('detach')}>x</:define>` +
        '</head><body><div :for-data=${on}>' +
        '<my-outer :tag="out"><my-inner :tag="in" /></my-outer>' +
        '</div></body></html>'
    );
    expect(log).toStrictEqual(['attach out', 'attach in']);

    log.length = 0;
    ctx!.root.proxy.on = null;
    expect(log).toStrictEqual(['detach in', 'detach out']);
  });

  it('refuses a callback the runtime has no moment for', async () => {
    // the failure mode these had while unimplemented: compiled, and never
    // called. A closed set of suffixes is what stops a typo doing that
    const p = build('<html><body><i :did-mount=${() => {}}>x</i></body></html>');
    expect(p.errors.map(e => e.msg)).toStrictEqual([
      'Unknown lifecycle callback ":did-mount": expected one of ":did-init", ' +
        '":did-attach", ":will-detach", ":will-dispose"',
    ]);
  });

  it('keeps a failing callback from taking the rest of the teardown with it', async () => {
    const { ctx, log } = await run(
      '<html :rows=${[1]}><head>' +
        '<:define tag="my-bad:i" :will-detach=${() => { throw new Error("boom"); }} ' +
        ':will-dispose=${() => { globalThis.LIFECYCLE_LOG.push("still ran"); }}>x</:define>' +
        '</head><body><my-bad :for-each=${rows} /></body></html>'
    );
    log.length = 0;
    ctx!.root.proxy.rows = [];
    expect(log).toContain('ERROR boom');
    expect(log).toContain('still ran');
  });
});
