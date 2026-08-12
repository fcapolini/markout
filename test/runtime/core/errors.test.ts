import { describe, expect, it } from 'vitest';
import { CoreContext, RuntimeError } from '../../../src/runtime/core/core-context';
import { CoreScopeProps } from '../../../src/runtime/core/core-scope';

function setup(root: CoreScopeProps) {
  const errors: RuntimeError[] = [];
  const ctx = new CoreContext({ root, onError: e => errors.push(e) });
  return { ctx, errors };
}

describe('runtime error reporting', () => {
  it('yields undefined from a failed expression rather than its previous value', () => {
    const { ctx } = setup({
      id: '0',
      values: {
        n: { val: { x: 1 } as any },
        out: {
          exp: function (this: any) { return this.n.x; },
          deps: [function (this: any) { return this.$value('n'); }],
        },
      },
    });
    ctx.refresh();
    expect(ctx.root.proxy.out).toBe(1);

    ctx.root.proxy.n = null;

    // keeping the old value would show 1 -- stale data presented as current,
    // and a result that depends on which evaluations happened to succeed
    expect(ctx.root.proxy.out).toBeUndefined();
  });

  it('reports a failed expression with the scope and value that failed', () => {
    const { ctx, errors } = setup({
      id: 's7',
      values: { boom: { exp: function () { return (null as any).x; } } },
    });
    ctx.refresh();

    expect(errors).toHaveLength(1);
    expect(errors[0].phase).toBe('update');
    expect(errors[0].scope).toBe('s7');
    expect(errors[0].key).toBe('boom');
  });

  it('reports a dependency that resolves to nothing instead of staying silent', () => {
    const { ctx, errors } = setup({
      id: '0',
      values: {
        count: { val: 1 },
        doubled: {
          exp: function (this: any) { return this.count * 2; },
          // nothing declares "nope": only a compiler bug produces this, and
          // its sole symptom would otherwise be a binding that never updates
          deps: [function (this: any) { return this.$value('nope'); }],
        },
      },
    });
    ctx.refresh();

    const link = errors.filter(e => e.phase === 'link');
    expect(link).toHaveLength(1);
    expect(link[0].key).toBe('doubled');
  });

  it('reports a repeatedly-failing expression once, not once per cycle', () => {
    const { ctx, errors } = setup({
      id: '0',
      values: { boom: { exp: function () { return (null as any).x; } } },
    });
    ctx.refresh();
    ctx.refresh();
    ctx.refresh();

    expect(errors).toHaveLength(1);
  });

  it('lets the rest of a batch run when one change callback throws', () => {
    const { ctx, errors } = setup({
      id: '0',
      values: { a: { val: 1 }, b: { val: 2 }, c: { val: 3 } },
    });
    const ran: string[] = [];
    ctx.root.values['a'].setCB(() => { throw new Error('boom'); });
    ctx.root.values['b'].setCB(() => { ran.push('b'); });
    ctx.root.values['c'].setCB(() => { ran.push('c'); });

    ctx.applyPending();

    // b and c are unrelated values that merely changed in the same cycle;
    // a's failure must not cost them their notification
    expect(ran).toStrictEqual(['b', 'c']);
    expect(errors.map(e => e.phase)).toStrictEqual(['callback']);
    // and the batch is still drained, so it can't leak into the next cycle
    expect(ctx.pending.size).toBe(0);
  });

  it('falls back to console when no onError hook is given', () => {
    const seen: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { seen.push(args[0]); };
    try {
      new CoreContext({
        root: {
          id: 's2',
          values: { boom: { exp: function () { return (null as any).x; } } },
        },
      }).refresh();
    } finally {
      console.error = original;
    }
    expect(seen).toHaveLength(1);
    expect(String(seen[0])).toContain('markout [update] s2.boom');
  });
});
