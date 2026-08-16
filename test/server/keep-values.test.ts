import { afterEach, describe, expect, it, vi } from 'vitest';
import { Page } from '../../src/compiler/ir/Page';
import { parse } from '../../src/html/parser';
import { stage1load } from '../../src/compiler/stages/stage1-load';
import { stage2validate } from '../../src/compiler/stages/stage2-validate';
import { stage3qualify } from '../../src/compiler/stages/stage3-qualify';
import { stage4resolve } from '../../src/compiler/stages/stage4-resolve';
import { stage7generate } from '../../src/compiler/stages/stage7-generate';
import { renderPage } from '../../src/server/render';
import { CoreContext, STATE_GLOBAL } from '../../src/runtime/core/core-context';
import type { PageState } from '../../src/runtime/core/core-context';
import type { CoreScope, CoreScopeProps } from '../../src/runtime/core/core-scope';

// End to end: the server renders, collects its `:keep-` values, and writes
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

/** a client rehydrating the served page: same props, plus whatever state the
 *  server sent */
function rehydrate(page: Page, state?: PageState) {
  const root = new Function(`return (${page.propsString});`)() as CoreScopeProps;
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

describe(':keep- end to end', () => {
  it('sends the server\'s result and the client uses it', () => {
    sequence(0.25, 0.75);
    const page = compile('<html :keep-r=${Math.random()}><body>${r}</body></html>');
    expect(renderPage(page)).toStrictEqual([]);

    // the server evaluated it once, and the markup shows that result
    expect(page.source.doc.toString()).toContain('0.25');

    const state = readState(page);
    expect(state).toBeDefined();
    expect(Object.values(state!)[0]).toStrictEqual({ r: 0.25 });

    // and the client, handed that state, does not reach for 0.75
    expect(rehydrate(page, state).root.proxy.r).toBe(0.25);
  });

  it('re-derives when no state reaches it', () => {
    // the control for the test above: without the state the same props do
    // re-run the expression, which is exactly the flip this feature prevents
    sequence(0.25, 0.75);
    const page = compile('<html :keep-r=${Math.random()}><body>${r}</body></html>');
    renderPage(page);
    expect(rehydrate(page, undefined).root.proxy.r).toBe(0.75);
  });

  it('leaves an unmarked value re-derived', () => {
    sequence(0.25, 0.75);
    const page = compile('<html :r=${Math.random()}><body>${r}</body></html>');
    expect(renderPage(page)).toStrictEqual([]);
    expect(page.stateScript).toBeUndefined();
    expect(rehydrate(page, readState(page)).root.proxy.r).toBe(0.75);
  });

  it('freezes the kept value but not what reads it', () => {
    // a dependent value is an ordinary one: it re-derives on the client, and
    // still tracks its own dependencies afterwards. Only the marked value is
    // pinned -- which is why the rule is to keep the source, not the derivation
    sequence(0.5);
    const page = compile(
      '<html :keep-base=${Math.random()} :n=${1}><body>${base * n}</body></html>'
    );
    expect(renderPage(page)).toStrictEqual([]);
    const ctx = rehydrate(page, readState(page));
    expect(ctx.root.proxy.base).toBe(0.5);
    ctx.root.proxy.n = 4;
    expect(ctx.root.proxy.base).toBe(0.5);
    expect(ctx.root.proxy.n).toBe(4);
  });

  it('carries the types JSON would flatten', () => {
    const page = compile(
      '<html :keep-d=${new Date(1700000000000)} :keep-u=${undefined}>' +
        '<body>${d}${u}</body></html>'
    );
    expect(renderPage(page)).toStrictEqual([]);
    const values = Object.values(readState(page)!)[0];
    expect(values.d).toStrictEqual(new Date(1700000000000));
    expect(values.u).toBeUndefined();
    expect('u' in values).toBe(true);
  });
});

describe(':keep- inside a :for-each', () => {
  it('keys each replica separately', () => {
    // the open question the design left: `uid` is props.id plus the replica
    // path, so two replicas of one declaration must not collide -- otherwise
    // every row in a list would be handed the first row's result
    sequence(0.1, 0.2, 0.9);
    const page = compile(
      '<html><body><div :for-each=${[1, 2]} :keep-r=${Math.random()}>${r}</div></body></html>'
    );
    expect(renderPage(page)).toStrictEqual([]);

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

  it('gives each replica back its own result on the client', () => {
    sequence(0.1, 0.2, 0.9);
    const page = compile(
      '<html><body><div :for-each=${[1, 2]} :keep-r=${Math.random()}>${r}</div></body></html>'
    );
    renderPage(page);
    const ctx = rehydrate(page, readState(page));
    const replicas = findReplicas(ctx.root);
    expect(replicas).toHaveLength(2);
    expect(replicas.map(s => s.proxy.r)).toStrictEqual([0.1, 0.2]);
  });

  it('sends nothing for a :for-data with nothing to show', () => {
    // the guard is the point of the directive: the body never evaluates
    // while the item is absent, so there is no result to send and a state
    // entry would be `undefined` standing in for "never ran"
    sequence(0.5);
    const page = compile(
      '<html><body><div :for-data=${null} :keep-r=${Math.random()}>${r}</div></body></html>'
    );
    expect(renderPage(page)).toStrictEqual([]);
    expect(readState(page)).toBeUndefined();
  });
});

describe(':keep- when a result cannot be sent', () => {
  it('reports it, ships the rest, and lets that one re-derive', () => {
    // one unsendable value must not cost the page its other state, and must
    // not pass silently: a page that quietly sent less than it meant to
    // would show the failure as a binding that renders wrong, far from
    // anything that explains it
    sequence(0.25, 0.75);
    const page = compile(
      '<html :keep-f=${() => 1} :keep-r=${Math.random()}><body>${r}${f}</body></html>'
    );
    const errors = renderPage(page);
    expect(errors).toHaveLength(1);
    expect(errors[0].phase).toBe('transfer');
    expect(errors[0].key).toBe('f');
    expect(errors[0].message).toMatch(/a function/);

    const values = Object.values(readState(page)!)[0];
    expect(values).toStrictEqual({ r: 0.25 });
    expect(typeof rehydrate(page, readState(page)).root.proxy.f).toBe('function');
  });
});
