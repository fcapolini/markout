import { CoreContext } from './core-context';
import { CoreScope } from './core-scope';
import { CoreValueProps } from './core-value';

/**
 * The names an expression may use without declaring them.
 *
 * An expression resolves every free name against the scope chain, and this
 * scope is its last link. Without a list like this one, `${Math.max(a, b)}`
 * qualifies to `this.Math`, resolves to nothing, and fails -- so the JS
 * standard library has to be here for expressions to be plain JavaScript,
 * which is the whole premise of `${...}`.
 *
 * The timers are here for the same reason, even though they do something
 * rather than compute something: they exist in both environments, and the
 * places that call them -- `:on-` and `:handle-` bodies -- only run in one.
 *
 * What is NOT here is as deliberate: `document`, `localStorage`, `fetch`,
 * and whatever libraries a page loads all exist in the browser and not on
 * the server. Naming one directly would give a page an expression
 * that works in one half of an isomorphic render and throws in the other,
 * with nothing in the source to say so. They are reached through
 * `globalThis` instead, which is on the list -- so the environment
 * dependency stays visible at the point of use:
 *
 *   :handle-open=${(v) => globalThis.bootstrap.Modal...}   // browser-only, and says so
 *
 * A page value of the same name shadows the global, since resolution only
 * reaches here after walking the scope chain.
 *
 * Kept in step with the compiler's copy in stage4-resolve.ts by a test.
 */
export const GLOBAL_NAMES = [
  'Array',
  'BigInt',
  'Boolean',
  'Date',
  'Error',
  'Infinity',
  'Intl',
  'JSON',
  'Map',
  'Math',
  'NaN',
  'Number',
  'Object',
  'Promise',
  'RegExp',
  'Set',
  'String',
  'Symbol',
  'WeakMap',
  'WeakSet',
  'clearInterval',
  'clearTimeout',
  'console',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'globalThis',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'queueMicrotask',
  'setInterval',
  'setTimeout',
  'structuredClone',
  'undefined',
];

//FIXME: server-side timer stuff should be no-ops
export class CoreGlobal extends CoreScope {
  constructor(
    context: CoreContext,
    additionalValues?: { [key: string | symbol]: CoreValueProps<any> }
  ) {
    const values: { [key: string | symbol]: CoreValueProps<any> } = {};
    for (const name of GLOBAL_NAMES) {
      // `val`, not `exp`: these never change, so they link as an inert source
      // and cost one lookup rather than a re-evaluation per cycle
      values[name] = { val: (globalThis as Record<string, unknown>)[name] };
    }
    super(
      {
        id: '-',
        name: 'window',
        values: { ...values, ...(additionalValues ?? {}) },
      },
      context
    );
  }
}
