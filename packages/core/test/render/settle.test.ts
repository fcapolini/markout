import { describe, expect, it } from 'vitest';
import { Page } from '../../src/compiler/ir/Page';
import { parse } from '../../src/html/parser';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../src/compiler/stages/stage7-generate';
import { renderPage } from '../../src/render/render';
import { STATE_GLOBAL } from '../../src/runtime/core/core-context';
import type { PageState } from '../../src/runtime/core/core-context';

// A `:server-` value may produce a promise, and the server waits for it
// before serializing. That is the whole of what the browser cannot do:
// hydration is synchronous, so a plain value's promise would have nothing to
// wait with -- which is why async is allowed exactly where the result can be
// sent. See docs/design/value-transfer.md.
//
// `Promise` is on the globals list, so these pages are written in the
// language as it stands, with no stub runtime and nothing injected.

function compile(html: string) {
  const p = new Page(parse(html, 'test.html'));
  stage1load(p);
  p.errors.length || stage2validate(p);
  p.errors.length || stage3qualify(p);
  p.errors.length || stage4resolve(p);
  p.errors.length || stage7generate(p);
  expect(p.errors.map(e => e.msg)).toStrictEqual([]);
  return p;
}

function readState(page: Page): PageState | undefined {
  const text = page.stateScript?.toString() ?? '';
  const js = text.replace(/^<script>/, '').replace(/<\/script>$/, '');
  if (!js.trim()) return undefined;
  const window: Record<string, unknown> = {};
  new Function('window', js)(window);
  return window[STATE_GLOBAL] as PageState;
}

function body(page: Page) {
  const markup = page.source.doc.toString();
  return markup
    .slice(markup.indexOf('<body'), markup.indexOf('<script'))
    .replace(/<!--.*?-->/g, '');
}

describe('a promise never reaches the page', () => {
  it('reads as undefined while it is in flight, not as a promise', async () => {
    // the rule that makes everything downstream ordinary: a page is written
    // against data, and a promise is the wrong shape for all of it -- truthy,
    // no `.length`, and "[object Promise]" when rendered. Held aside instead,
    // an unarrived value is `undefined`, which is what "not there" already
    // means everywhere else here
    const page = compile(
      '<html :server-v=${Promise.resolve(1)}' +
        ' :seen=${typeof v}' +
        ' :guarded=${v ? "truthy" : "falsy"}>' +
        '<body><i>${seen}</i><b>${guarded}</b></body></html>'
    );
    expect(await renderPage(page)).toStrictEqual([]);
    // by the end it has landed, so both read the settled value
    expect(body(page)).toContain('<i>number</i>');
    expect(body(page)).toContain('<b>truthy</b>');
    // and the page never carried the promise itself
    expect(page.source.doc.toString()).not.toContain('[object Promise]');
  });

  it('does not let a guard build work from a value that has not arrived', async () => {
    // `${a ? f(a) : null}` used to run against the promise, which is truthy:
    // with a real fetch that sent a request to a URL built out of "[object
    // Promise]". Now the guard sees undefined and declines, as written
    const page = compile(
      '<html :server-a=${Promise.resolve("x")}' +
        ' :server-b=${a ? Promise.resolve("saw:" + a) : null}>' +
        '<body><i>${b}</i></body></html>'
    );
    expect(await renderPage(page)).toStrictEqual([]);
    expect(body(page)).toContain('<i>saw:x</i>');
  });
});

describe('settling a :server- promise', () => {
  it('waits, and renders the result rather than the promise', async () => {
    const page = compile(
      '<html :server-n=${Promise.resolve(42)}><body><i>${n}</i></body></html>'
    );
    expect(await renderPage(page)).toStrictEqual([]);
    expect(body(page)).toContain('<i>42</i>');
    expect(Object.values(readState(page)!)[0]).toStrictEqual({ n: 42 });
  });

  it('sends the resolved value, not something the client must await', async () => {
    // the point of settling on the server: what crosses is data, so the
    // browser has nothing to wait for and no flash to show
    const page = compile(
      '<html :server-d=${Promise.resolve({ ok: true })}><body>${d.ok}</body></html>'
    );
    await renderPage(page);
    expect(Object.values(readState(page)!)[0]).toStrictEqual({ d: { ok: true } });
  });

  it('leaves a plain value\'s promise alone', async () => {
    // unmarked, so its result could not be sent even if it were awaited --
    // the browser would re-run the expression and get its own promise
    const page = compile('<html :n=${Promise.resolve(1)}><body>${n}</body></html>');
    expect(await renderPage(page)).toStrictEqual([]);
    expect(page.stateScript).toBeUndefined();
  });
});

describe('settling a waterfall', () => {
  it('follows a chain where one result feeds the next', async () => {
    // One round per link. While `a` is in flight it reads as `undefined` --
    // the promise is held off the reactive system entirely -- so the guard
    // here does what it looks like it does and `b` stays null rather than
    // building a request out of a promise. Only once `a` lands does `b`
    // produce one of its own, and `c` after that.
    const page = compile(
      '<html :server-a=${Promise.resolve(2)}' +
        ' :server-b=${a ? Promise.resolve(a * 10) : null}' +
        ' :server-c=${b ? Promise.resolve(b + 1) : null}>' +
        '<body><i>${c}</i></body></html>'
    );
    expect(await renderPage(page)).toStrictEqual([]);
    expect(body(page)).toContain('<i>21</i>');
    expect(Object.values(readState(page)!)[0]).toStrictEqual({ a: 2, b: 20, c: 21 });
  });

  it('waits for a source even when nothing guards the read', async () => {
    // The case the ordering rule is for, and the only one left now that a
    // promise is never a value: `a` reads `undefined` while it is in flight,
    // so this computes NaN and asks for it in earnest. Settling that would
    // freeze NaN -- settling drops the expression -- and the page would
    // render it with nothing reported. Skipped instead, `a` landing
    // re-evaluates it against the real number.
    const page = compile(
      '<html :server-a=${Promise.resolve(2)}' +
        ' :server-b=${Promise.resolve(a * 10)}>' +
        '<body><i>${b}</i></body></html>'
    );
    expect(await renderPage(page)).toStrictEqual([]);
    expect(body(page)).toContain('<i>20</i>');
  });

  it('reports two server values that wait on each other', async () => {
    // this compiles: neither reads ITSELF, which is all the compiler
    // refuses. Nothing can be ordered first, so nothing is settled -- and
    // saying so beats handing the page whatever each computed from the
    // other's absence
    const page = compile(
      '<html :server-a=${Promise.resolve(b)} :server-b=${Promise.resolve(a)}>' +
        '<body>${a}${b}</body></html>'
    );
    const started = Date.now();
    const errors = await renderPage(page, { settle: { maxRounds: 3, timeoutMs: 30_000 } });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(errors).toHaveLength(2);
    expect(errors.every(e => e.phase === 'settle')).toBe(true);
    expect(errors[0].message).toMatch(/wait on each other/);
  });

  it('stops a chain deeper than the cap, without waiting for the deadline', async () => {
    // each link costs a round, so the cap is a limit on DEPTH. A page past it
    // is reported as a page bug rather than stalling to the deadline on every
    // request while reporting nothing but slowness
    const page = compile(
      '<html :server-a=${Promise.resolve(1)}' +
        ' :server-b=${a ? Promise.resolve(a + 1) : null}' +
        ' :server-c=${b ? Promise.resolve(b + 1) : null}>' +
        '<body>${c}</body></html>'
    );
    const started = Date.now();
    const errors = await renderPage(page, { settle: { maxRounds: 2, timeoutMs: 30_000 } });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(errors).toHaveLength(1);
    expect(errors[0].phase).toBe('settle');
    expect(errors[0].key).toBe('c');
    expect(errors[0].message).toMatch(/still pending after 2 rounds/);
  });
});

describe('when a :server- promise does not arrive', () => {
  it('reports a rejection and leaves the value undefined', async () => {
    const page = compile(
      '<html :server-n=${Promise.reject(new Error("nope"))}><body>${n}</body></html>'
    );
    const errors = await renderPage(page);
    expect(errors).toHaveLength(1);
    expect(errors[0].phase).toBe('settle');
    expect(errors[0].key).toBe('n');
    expect(errors[0].message).toBe('nope');
    // `undefined`, always -- never the promise it held, and never nothing at
    // all: the same rule an expression that throws already follows
    expect(Object.values(readState(page)!)[0]).toStrictEqual({ n: undefined });
  });

  it('gives up at the deadline and still serves the page', async () => {
    const page = compile(
      '<html :server-slow=${new Promise(() => {})} :server-fast=${Promise.resolve(1)}>' +
        '<body><i>${fast}</i></body></html>'
    );
    const errors = await renderPage(page, { settle: { timeoutMs: 50 } });
    expect(errors).toHaveLength(1);
    expect(errors[0].phase).toBe('settle');
    expect(errors[0].key).toBe('slow');
    expect(errors[0].message).toMatch(/timed out after 50ms/);

    // the page is what the visitor came for: everything else still rendered
    expect(body(page)).toContain('<i>1</i>');
    expect(Object.values(readState(page)!)[0]).toStrictEqual({ fast: 1, slow: undefined });
  });

  it('budgets the deadline across the whole render, not per promise', async () => {
    // three slow values must not cost three timeouts' worth of waiting
    const page = compile(
      '<html :server-a=${new Promise(() => {})} :server-b=${new Promise(() => {})}' +
        ' :server-c=${new Promise(() => {})}><body>${a}${b}${c}</body></html>'
    );
    const started = Date.now();
    const errors = await renderPage(page, { settle: { timeoutMs: 60 } });
    const elapsed = Date.now() - started;
    expect(errors).toHaveLength(3);
    expect(elapsed).toBeLessThan(400);
  });
});

describe('settling inside a :for-each', () => {
  it('settles a value the datasource itself brought into being', async () => {
    // the case the loop exists for: settling `rows` creates replicas that did
    // not exist when the first round looked, each with a server value of its
    // own. Walking fresh each round is what finds them
    const page = compile(
      '<html :server-rows=${Promise.resolve([1, 2])}><body>' +
        '<div :for-each=${rows ?? []} :server-doubled=${Promise.resolve(data * 2)}>' +
        '${doubled}</div></body></html>'
    );
    expect(await renderPage(page)).toStrictEqual([]);
    const markup = body(page);
    expect(markup).toContain('2');
    expect(markup).toContain('4');

    const perScope = Object.values(readState(page)!);
    expect(perScope).toContainEqual({ doubled: 2 });
    expect(perScope).toContainEqual({ doubled: 4 });
  });
});
