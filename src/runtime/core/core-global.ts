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
 * The timers and `fetch` are here for the same reason, even though they do
 * something rather than compute something: they exist in both environments,
 * and the places that call them -- `:on-` and `:handle-` bodies -- only run
 * in one.
 *
 * What is NOT here is as deliberate: `document`, `localStorage`, and
 * whatever libraries a page loads all exist in the browser and not on
 * the server. Naming one directly would give a page an expression
 * that works in one half of an isomorphic render and throws in the other,
 * with nothing in the source to say so. They are reached through
 * `globalThis` instead, which is on the list -- so the environment
 * dependency stays visible at the point of use:
 *
 *   :handle-open=${(v) => globalThis.bootstrap.Modal...}   // browser-only, and says so
 *
 * `$origin` is the exception to all of the above: it is not read off
 * `globalThis` at all, but supplied by whoever built the context -- from the
 * request on the server, from `location.origin` in the browser. It is here
 * because it means the same thing in both, which is the same bar every other
 * name on this list has to clear; it is spelled with a `$` because it is the
 * runtime's rather than JavaScript's. Nothing else about the request is
 * offered, and deliberately: headers, cookies and method have no browser
 * counterpart, so a page reading one would render something it cannot
 * hydrate to -- and would publish a session while doing it.
 *
 * A page value of the same name shadows the global, since resolution only
 * reaches here after walking the scope chain.
 *
 * Kept in step with the compiler's copy in stage4-resolve.ts by a test.
 */
export const ORIGIN_GLOBAL = '$origin';

export const GLOBAL_NAMES = [
  ORIGIN_GLOBAL,
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
  'URL',
  'WeakMap',
  'WeakSet',
  'clearInterval',
  'clearTimeout',
  'console',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'fetch',
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

/**
 * The globals that are METHODS of the global object rather than
 * constructors or namespaces.
 *
 * An expression reaches one as `this.setTimeout(...)`, where `this` is the
 * scope's proxy -- and a browser's timers and `fetch` insist on the global
 * object as their receiver, so an unbound one throws "Illegal invocation"
 * the first time a `:did-init` calls it. They are bound here rather than
 * left to the caller: reaching for `globalThis.setTimeout` to work around it
 * would say "this line needs a browser" about a name that is on the list
 * precisely because it doesn't.
 *
 * Only these. Binding a constructor (`Array`, `Promise`) would drop the
 * statics hanging off it, so `Array.from(...)` -- which the kit's own
 * pagination uses -- would stop resolving. `new` on a bound function still
 * works, but `.from` on one does not.
 */
const BOUND_GLOBAL_NAMES = new Set([
  'clearInterval',
  'clearTimeout',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'fetch',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'queueMicrotask',
  'setInterval',
  'setTimeout',
  'structuredClone',
]);

//FIXME: server-side timer stuff should be no-ops
export class CoreGlobal extends CoreScope {
  constructor(
    context: CoreContext,
    additionalValues?: { [key: string | symbol]: CoreValueProps<any> }
  ) {
    const values: { [key: string | symbol]: CoreValueProps<any> } = {};
    for (const name of GLOBAL_NAMES) {
      const val = (globalThis as Record<string, unknown>)[name];
      // `val`, not `exp`: these never change, so they link as an inert source
      // and cost one lookup rather than a re-evaluation per cycle
      values[name] = {
        val:
          BOUND_GLOBAL_NAMES.has(name) && typeof val === 'function'
            ? (val as (...args: unknown[]) => unknown).bind(globalThis)
            : val,
      };
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
