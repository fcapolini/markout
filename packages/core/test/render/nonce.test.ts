import { describe, expect, it } from 'vitest';
import { Page } from '../../src/compiler/ir/Page';
import { parse } from '../../src/html/parser';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../src/compiler/stages/stage7-generate';
import { renderPage } from '../../src/render/render';

// A served page carries three scripts nobody wrote: the props, the
// transferred state, and the runtime. A strict Content-Security-Policy is
// impossible unless all three can be named, which is what the nonce does.
// See MarkoutProps.csp for why the header is still the application's.

function compile(html: string) {
  const p = new Page(parse(html, 'test.html'));
  stage1load(p);
  p.errors.length || stage2validate(p);
  p.errors.length || stage3qualify(p);
  p.errors.length || stage4resolve(p);
  p.errors.length || stage7generate(p);
  return p;
}

function scriptNonces(page: Page): (string | null)[] {
  return page.bootstrapScripts
    .filter(s => s.parentNode)
    .map(s => s.getAttribute('nonce'));
}

const PAGE = '<html><body><div :count=${2}>${count}</div></body></html>';
const WITH_SERVER_VALUE =
  '<html><body><div :server-n=${41}>${n + 1}</div></body></html>';

describe('CSP nonce', () => {
  it('stamps every script markout injected', async () => {
    const page = compile(WITH_SERVER_VALUE);
    await renderPage(page, { nonce: 'abc123' });

    // props, state and runtime -- all three, or the policy has to name the
    // ones left out some other way, which is what having a nonce was for
    expect(scriptNonces(page)).toStrictEqual(['abc123', 'abc123', 'abc123']);
    expect(page.source.doc.toString()).toContain('nonce="abc123"');
  });

  it('carries none when the server was not asked for one', async () => {
    const page = compile(PAGE);
    await renderPage(page);

    expect(scriptNonces(page).every(n => n === null)).toBe(true);
    expect(page.source.doc.toString()).not.toContain('nonce');
  });

  it('leaves nothing behind for the next request', async () => {
    // the compiled page is cached and rendered again per request, so a nonce
    // that outlived its response would be served to somebody else -- and a
    // nonce two responses share is not one
    const page = compile(WITH_SERVER_VALUE);
    await renderPage(page, { nonce: 'first' });
    await renderPage(page, { nonce: 'second' });
    expect(scriptNonces(page)).toStrictEqual(['second', 'second', 'second']);

    await renderPage(page);
    expect(scriptNonces(page).every(n => n === null)).toBe(true);
    expect(page.source.doc.toString()).not.toContain('first');
  });

  it('stamps a page that has no props at all', async () => {
    // `renderPage` returns early for one, and the scripts are still there
    const page = compile('<html><body>plain</body></html>');
    await renderPage(page, { nonce: 'abc123' });

    const scripts = scriptNonces(page);
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every(n => n === 'abc123')).toBe(true);
  });
});
