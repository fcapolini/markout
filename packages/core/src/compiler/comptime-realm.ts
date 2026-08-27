import vm from 'vm';

/**
 * Where a `:const-` value is computed.
 *
 * The compiler evaluates compile-time constants, which means running an
 * author's JavaScript inside whatever process is compiling -- a `markout
 * build` in CI, and the language server on every keystroke. That was
 * `new Function(...)()`, which runs in THIS realm and hands the expression
 * everything the host has.
 *
 * It looked contained and was not. Free identifiers compile to `$.name`, so
 * an expression naming a global fails with `$ is not defined` -- but that is
 * name resolution failing, not a guard, and nothing that avoids naming a
 * global goes near it. Measured, every one of these reached `process` from a
 * kit's own fragment:
 *
 *     ''.constructor.constructor('return process')()
 *     [].constructor.constructor(...)      (0).constructor.constructor(...)
 *     ({}).constructor.constructor(...)    /x/.constructor.constructor(...)
 *     (()=>1).constructor(...)             (async()=>1).constructor(...)
 *     (function(){ return this })()        // sloppy mode: `this` IS the global
 *
 * That is not a list of holes to patch. `x.constructor.constructor` is
 * `Function` for every object in the language, and a `Function` body is
 * evaluated in its realm's global scope -- so any allowlist that hands over
 * real objects from the host realm hands over the realm. Closing the routes
 * one at a time would mean removing `Object`, `Array`, `String` and the rest,
 * which is removing JavaScript.
 *
 * So the realm is what changes, not the list of names. In a context of its
 * own, every route above resolves to THAT context's globals, where there is
 * no `process`, no `require` and nothing else of the host's.
 *
 * ## Why this is sound, given `vm` is not a security boundary
 *
 * Node says so, and it is right: `vm` leaks when host objects are put INTO a
 * context, because their prototypes lead back out. Seeding a context with the
 * outer realm's `Object` re-opens it completely, which is measured and
 * asserted in the tests next door.
 *
 * Nothing is seeded here. The context is created from a null-prototype object
 * and receives nothing, the code that runs in it is generated from the
 * author's own expression, and the only thing that crosses back is a
 * primitive -- stage 5 refuses any other result, and did so before this
 * existed, for an unrelated reason. A boundary that passes nothing in and
 * primitives out is one `vm` holds.
 *
 * Two further limits come free and are worth having on their own:
 *
 * - **`codeGeneration.strings: false`** turns off `eval` and the `Function`
 *   constructor INSIDE the context. A constant has no use for either -- it
 *   computes a token from literals -- so this costs nothing and means the
 *   prototype routes above fail at the last step as well as at the realm.
 * - **A timeout.** `:const-x=${(()=>{ for(;;); })()}` used to hang whatever
 *   was compiling, which in the editor is a language server that never
 *   answers again.
 */

/**
 * How long one constant may take.
 *
 * Generous for a design token, which computes in microseconds, and short
 * enough that a page which hangs the compiler is a slow save rather than a
 * dead editor.
 */
export const COMPTIME_TIMEOUT_MS = 1000;

/** evaluates compile-time expressions, in a realm that is not this one */
export interface ComptimeRealm {
  /** the value of `code`, or a throw -- callers report it against the value */
  run(code: string): unknown;
}

/**
 * A realm for one page's constants.
 *
 * Created on the first constant and reused for the rest of that page: a
 * fresh context costs ~0.26ms and an evaluation in a warm one ~0.05ms, so
 * per-page keeps a page with a dozen tokens well inside its own compile,
 * while a page with none pays nothing at all. Per-page rather than
 * per-process so that whatever one page's constants do to their sandbox
 * cannot be read by the next page's.
 */
export function comptimeRealm(): ComptimeRealm {
  let context: vm.Context | undefined;
  return {
    run(code: string): unknown {
      context ??= vm.createContext(Object.create(null), {
        codeGeneration: { strings: false, wasm: false },
      });
      return vm.runInContext(code, context, {
        timeout: COMPTIME_TIMEOUT_MS,
        displayErrors: false,
      });
    },
  };
}
