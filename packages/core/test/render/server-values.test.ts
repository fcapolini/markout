import { afterEach, describe, expect, it, vi } from 'vitest';
import { Page } from '../../src/compiler/ir/Page';
import { parse } from '../../src/html/parser';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../src/compiler/stages/stage7-generate';
import { renderPage } from '../../src/render/render';
import { CoreContext, STATE_GLOBAL } from '../../src/runtime/core/core-context';
import type { PageState } from '../../src/runtime/core/core-context';
import type { CoreScope, CoreScopeProps } from '../../src/runtime/core/core-scope';

// End to end: the server renders, collects its `:server-` values, and writes
// them into the reserved script; a client built from the same props plus that
// state gets the server's results rather than deriving its own.
//
// `Math.random` is stubbed with a sequence, so "the client did not re-run the
// expression" is an exact assertion rather than a probabilistic one: a client
// that re-evaluated would see the NEXT number, not the same one.

function compile(html: string) {
  const p = new Page(parse(html, 'test.html'));
  stage1load(p);
  p.errors.length || stage2validate(p);
  p.errors.length || stage3qualify(p);
  p.errors.length || stage4resolve(p);
  p.errors.length || stage7generate(p);
  return p;
}

/** runs the emitted state script the way a browser would, and hands back what
 *  it set on `window` */
function readState(page: Page): PageState | undefined {
  const text = page.stateScript?.toString() ?? '';
  const js = text.replace(/^<script>/, '').replace(/<\/script>$/, '');
  if (!js.trim()) return undefined;
  const window: Record<string, unknown> = {};
  new Function('window', js)(window);
  return window[STATE_GLOBAL] as PageState;
}

/** a client rehydrating the served page: the props the BROWSER is given --
 *  not the server's -- plus whatever state came with them */
function rehydrate(page: Page, state?: PageState) {
  const root = new Function(`return (${page.clientPropsString});`)() as CoreScopeProps;
  return new CoreContext({ root, state }).refresh();
}

/** the replicas of the page's one `:for-each`, wherever it sits in the tree */
function findReplicas(scope: CoreScope): CoreScope[] {
  if (scope.clones?.length) return scope.clones;
  for (const child of scope.children) {
    const found = findReplicas(child);
    if (found.length) return found;
  }
  return [];
}

afterEach(() => vi.restoreAllMocks());

function sequence(...values: number[]) {
  let i = 0;
  vi.spyOn(Math, 'random').mockImplementation(() => values[Math.min(i++, values.length - 1)]);
}

describe(':server- end to end', () => {
  it('sends the server\'s result and the client uses it', async () => {
    sequence(0.25, 0.75);
    const page = compile('<html :server-r=${Math.random()}><body>${r}</body></html>');
    expect(await renderPage(page)).toStrictEqual([]);

    // the server evaluated it once, and the markup shows that result
    expect(page.source.doc.toString()).toContain('0.25');

    const state = readState(page);
    expect(state).toBeDefined();
    expect(Object.values(state!)[0]).toStrictEqual({ r: 0.25 });

    // and the client, handed that state, does not reach for 0.75
    expect(rehydrate(page, state).root.proxy.r).toBe(0.25);
  });

  it('is empty, not re-derived, when no state reaches it', async () => {
    // the control for the test above. The browser is not given the
    // expression at all, so a lost result is `undefined` -- never a second,
    // DIFFERENT answer, which is the flip this whole feature exists to stop
    sequence(0.25, 0.75);
    const page = compile('<html :server-r=${Math.random()}><body>${r}</body></html>');
    await renderPage(page);
    expect(rehydrate(page, undefined).root.proxy.r).toBeUndefined();
  });

  it('does not put the server expression in the page at all', async () => {
    // the disclosure this closes: a server expression is written to run where
    // the visitor cannot see, so its BODY -- a query, a table name, the shape
    // of an internal API -- must not arrive in the source of the page
    const page = compile(
      '<html :server-r=${fetch("/internal/q?table=users").then(x => x)}>' +
        '<body>${r}</body></html>'
    );
    await renderPage(page);
    expect(page.propsString).toContain('/internal/q');
    expect(page.clientPropsString).not.toContain('/internal/q');
    expect(page.source.doc.toString()).not.toContain('/internal/q');
  });

  it('leaves an unmarked value re-derived', async () => {
    sequence(0.25, 0.75);
    const page = compile('<html :r=${Math.random()}><body>${r}</body></html>');
    expect(await renderPage(page)).toStrictEqual([]);
    expect(page.stateScript).toBeUndefined();
    // unmarked: its expression IS sent, so the browser derives its own
    expect(rehydrate(page, readState(page)).root.proxy.r).toBe(0.75);
  });

  it('freezes the server-only value but not what reads it', async () => {
    // a dependent value is an ordinary one: it re-derives on the client, and
    // still tracks its own dependencies afterwards. Only the marked value is
    // pinned -- which is why the rule is to keep the source, not the derivation
    sequence(0.5);
    const page = compile(
      '<html :server-base=${Math.random()} :n=${1}><body>${base * n}</body></html>'
    );
    expect(await renderPage(page)).toStrictEqual([]);
    const ctx = rehydrate(page, readState(page));
    expect(ctx.root.proxy.base).toBe(0.5);
    ctx.root.proxy.n = 4;
    expect(ctx.root.proxy.base).toBe(0.5);
    expect(ctx.root.proxy.n).toBe(4);
  });

  it('carries the types JSON would flatten', async () => {
    const page = compile(
      '<html :server-d=${new Date(1700000000000)} :server-u=${undefined}>' +
        '<body>${d}${u}</body></html>'
    );
    expect(await renderPage(page)).toStrictEqual([]);
    const values = Object.values(readState(page)!)[0];
    expect(values.d).toStrictEqual(new Date(1700000000000));
    expect(values.u).toBeUndefined();
    expect('u' in values).toBe(true);
  });
});

describe(':server- inside a :for-each', () => {
  it('keys each replica separately', async () => {
    // the open question the design left: `uid` is props.id plus the replica
    // path, so two replicas of one declaration must not collide -- otherwise
    // every row in a list would be handed the first row's result
    sequence(0.1, 0.2, 0.9);
    const page = compile(
      '<html><body><div :for-each=${[1, 2]} :server-r=${Math.random()}>${r}</div></body></html>'
    );
    expect(await renderPage(page)).toStrictEqual([]);

    const state = readState(page)!;
    const perReplica = Object.values(state).map(v => v.r);
    expect(perReplica).toStrictEqual([0.1, 0.2]);
    // two entries under two distinct uids, not one shared
    expect(Object.keys(state)).toHaveLength(2);
    expect(new Set(Object.keys(state)).size).toBe(2);

    const html = page.source.doc.toString();
    expect(html).toContain('0.1');
    expect(html).toContain('0.2');
  });

  it('gives each replica back its own result on the client', async () => {
    sequence(0.1, 0.2, 0.9);
    const page = compile(
      '<html><body><div :for-each=${[1, 2]} :server-r=${Math.random()}>${r}</div></body></html>'
    );
    await renderPage(page);
    const ctx = rehydrate(page, readState(page));
    const replicas = findReplicas(ctx.root);
    expect(replicas).toHaveLength(2);
    expect(replicas.map(s => s.proxy.r)).toStrictEqual([0.1, 0.2]);
  });

  it('sends nothing for a :for-data with nothing to show', async () => {
    // the guard is the point of the directive: the body never evaluates
    // while the item is absent, so there is no result to send and a state
    // entry would be `undefined` standing in for "never ran"
    sequence(0.5);
    const page = compile(
      '<html><body><div :for-data=${null} :server-r=${Math.random()}>${r}</div></body></html>'
    );
    expect(await renderPage(page)).toStrictEqual([]);
    expect(readState(page)).toBeUndefined();
  });
});

describe(':server- when a result cannot be sent', () => {
  it('reports it, ships the rest, and leaves that one undefined', async () => {
    // one unsendable value must not cost the page its other state, and must
    // not pass silently: a page that quietly sent less than it meant to
    // would show the failure as a binding that renders wrong, far from
    // anything that explains it
    sequence(0.25, 0.75);
    const page = compile(
      '<html :server-f=${() => 1} :server-r=${Math.random()}><body>${r}${f}</body></html>'
    );
    const errors = await renderPage(page);
    expect(errors).toHaveLength(1);
    expect(errors[0].phase).toBe('transfer');
    expect(errors[0].key).toBe('f');
    expect(errors[0].message).toMatch(/a function/);

    const values = Object.values(readState(page)!)[0];
    expect(values).toStrictEqual({ r: 0.25 });
    // and NOT re-derived in the browser. There is no expression there to
    // re-derive from: a server expression reaches for what only the server
    // has, so running it again is not a fallback, it is a different failure
    expect(rehydrate(page, readState(page)).root.proxy.f).toBeUndefined();
  });
});

describe('$origin', () => {
  it('is what the caller supplied, on both sides', async () => {
    // the same fact reached two different ways -- from the request while
    // rendering, from `location.origin` in the browser -- which is the whole
    // reason it is a name rather than something each page states for itself
    const page = compile('<html><body><i>${$origin}</i></body></html>');
    expect(await renderPage(page, { origin: 'https://example.test' })).toStrictEqual([]);
    expect(page.source.doc.toString()).toContain('https://example.test');
  });

  it('is undefined when nobody supplied one', async () => {
    // a page compiled outside any server has no origin, and saying so beats
    // inventing one that the browser would then disagree with
    const page = compile('<html><body><i>${$origin ?? "none"}</i></body></html>');
    expect(await renderPage(page)).toStrictEqual([]);
    expect(page.source.doc.toString()).toContain('none');
  });

  it('cannot be shadowed, unlike the other globals', async () => {
    // `$` is reserved in a DECLARED name, so a page cannot take this one over
    // the way it can take over `Math`. That is what the `$` is for: the list
    // it sits on is otherwise JavaScript's, and this name is the runtime's
    const page = compile('<html :$origin=${"mine"}><body>${$origin}</body></html>');
    expect(page.errors.map(e => e.msg).join()).toMatch(/Invalid name/);
  });
});
