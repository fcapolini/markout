/**
 * `@markout-lang/core` -- compile a page and render it. No HTTP anywhere.
 *
 * This file IS the package boundary: what is listed here is what another
 * package may depend on, and everything else is an internal of core's that
 * can be moved without warning. It is curated rather than a `export *` of
 * every module, because a barrel that re-exports everything is the same
 * thing as no boundary at all -- and because two modules here deliberately
 * share names (`html/dom` and `html/server-dom`), which a blanket re-export
 * would resolve by silently dropping one.
 *
 * It grows on demand: the language server that reads pages without serving
 * them will want the parser and the IR, and those get added when it does,
 * deliberately, one name at a time. See docs/design/monorepo.md.
 */

// what a page is compiled from, and into
export { Compiler } from './compiler';
export type { Page } from './compiler/ir/Page';
// the mark a component's interface is written with, so an editor offering
// those names spells them the way the compiler reads them
export { PARAMETER_MARKER } from './compiler/ir/Page';
export { DEFAULT_RUNTIME_SRC } from './compiler/stages/stage7-generate';
// what a name in an expression refers to, asked of the compiler rather than
// re-derived: see the editor support in packages/vscode
export {
  declarationFor,
  referencesTo,
  visibleFrom,
  type Declaration,
  type Reference,
  type Visible,
} from './compiler/stages/stage4-resolve';
export type { Scope } from './compiler/ir/Scope';
export type { Value } from './compiler/ir/Value';
export { PageError } from './html/parser';
export type { ReadFile } from './html/preprocessor';

// where files may be loaded from and served at
export { discoverKits, type Kit } from './kits';
export { contains, NPM_PREFIX, Resolver } from './paths';
export { allowedPageKits, publishablePath, walkTree } from './publish';

// running a compiled page
export {
  formatRuntimeError,
  STATE_GLOBAL,
  type PageState,
  type RuntimeError,
} from './runtime/core/core-context';
export { DOM_ERRORS_ID } from './runtime/web/web-context';

// server-side rendering, and the browser bundle a rendered page asks for
export { renderPage } from './render/render';
// mounting a compiled page against a DOM the caller supplies, which is what
// testing a component needs and what neither of the other two entry points
// can be borrowed for: see docs/reference/testing.md
export { hydrate, type Hydrated } from './render/hydrate';
export { loadProps } from './render/props';
export { loadClientCode, runtimeSrcFor, RUNTIME_CACHE_CONTROL, RUNTIME_BUNDLE_PATH } from './render/runtime-bundle';
