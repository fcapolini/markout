import type * as acorn from 'acorn';
import { PageError, Source } from '../../html/parser';
import type { ServerContainerNode, ServerElement, ServerNode } from '../../html/server-dom';
import type { Node } from 'estree';
import { DIRECTIVE_TAG_PREFIX } from '../../html/dom';
import { Scope } from './Scope';
import { Value } from './Value';

export const SPECIAL_ATTR_PREFIX = ':';
export const SCOPE_NAME_ATTR = 'aka';
// `:attr-x` toggles the PRESENCE of attribute x, the way `:class-x` toggles a
// class. Distinct from `x=${...}`, which sets its VALUE: HTML boolean
// attributes and custom-element ones mean true by being there at all, so
// `x=${false}` writing "false" reads as true. Which of the two is meant can't
// be told from the value (`aria-expanded="false"` is a real, required
// setting), so the author says which rather than the compiler guessing.
export const PRESENCE_VALUE_ATTR_PREFIX = 'attr-';
// `:prop-x` assigns the JS property x on the element, for what an attribute
// can't carry: objects, arrays, functions. The name is written verbatim
// (`:prop-maxLength`), since a property name is a JS identifier and this
// parser preserves attribute case.
export const PROP_VALUE_ATTR_PREFIX = 'prop-';
export const CLASS_VALUE_ATTR_PREFIX = 'class-';
export const STYLE_VALUE_ATTR_PREFIX = 'style-';
export const EVENT_VALUE_ATTR_PREFIX = 'on-';
export const DID_VALUE_ATTR_PREFIX = 'did-';
export const WILL_VALUE_ATTR_PREFIX = 'will-';
// `:handle-x=${(v) => ...}`: run this when value `x` changes. Sugar for a
// value whose expression CALLS the arrow with x, so the dependency on x
// falls out of the ordinary extraction and needs no runtime of its own
export const HANDLE_VALUE_ATTR_PREFIX = 'handle-';
// `:server-x=${...}`: this expression runs on the server only, and the client
// receives its result. Unlike the families above it is a MODIFIER, not a
// family of its own -- it is stripped before the rest of the name is parsed,
// and the value it marks is an ordinary one. See docs/design/value-transfer.md
export const SERVER_VALUE_ATTR_PREFIX = 'server-';
/**
 * `:if=${expr}` renders the element when the expression is truthy, and not
 * at all otherwise.
 *
 * Named for a JS reserved word on purpose, and that is the whole reason the
 * name was available: a value has to be something an expression can say, so
 * `:if=${...}` was already refused as a declaration (see validateName). No
 * page can have taken it, and none ever can -- which makes this the one
 * namespace a directive can occupy without a prefix to keep it clear.
 */
/**
 * `:when-used="tag-a tag-b"` keeps this element only while at least one of
 * those custom tags survives treeshaking.
 *
 * Build-time, and nothing about it reaches the runtime -- unlike `:if`,
 * which asks its question on every change. It exists for the assets a
 * component needs and a page without that component does not: a stylesheet,
 * a `<link>`, a `<script>`.
 *
 * Named rather than inferred from the fragment a style was declared in. A
 * stylesheet sitting next to some `<:define>`s is not necessarily THEIR
 * stylesheet -- Orbit's is the page's -- so "these definitions died, so
 * these styles are dead" would be wrong, not merely surprising.
 */
export const WHEN_USED_ATTR = 'when-used';
export const IF_ATTR = 'if';
/**
 * `:else-if=${expr}` and `:else`: the branches after an `:if`.
 *
 * They compile to the same `if$` value the `:if` does, because they are the
 * same question at the same arity -- does this element render -- and only
 * the way the answer is arrived at differs. What a branch adds is a link to
 * the one before it, so the runtime can show the first whose condition
 * holds and no more (see CoreScopeProps.elseOf).
 *
 * `else` is a reserved word, so it was free for exactly the reason `if` was.
 * `else-if` is free for a different one: a dash cannot appear in a plain
 * value name, and no family owns an `else-` prefix, so it was already a
 * compile error and no page can have been using it.
 *
 * Which branch a chain member continues is said by position and nothing
 * else, which is the one thing this feature asks of an author that `:if`
 * does not: an `:else` has to be the very next element after the branch it
 * belongs to. That adjacency is checked while loading, where the markup is
 * still the markup -- afterwards every branch has been wrapped in a
 * `<template>` and the question can no longer be asked.
 */
export const ELSE_IF_ATTR = 'else-if';
export const ELSE_ATTR = 'else';
export const IF_VALUE = 'if$';
export const TEXT_VALUE_PREFIX = 't$';
// compiled form of the ATTR prefixes above, as stored in Scope.values keys
export const CLASS_VALUE_PREFIX = 'class$';
export const STYLE_VALUE_PREFIX = 'style$';
export const ATTR_VALUE_PREFIX = 'attr$';
// deliberately not `attr$`: that one is already the value-setting form
export const PRESENCE_VALUE_PREFIX = 'flag$';
export const PROP_VALUE_PREFIX = 'prop$';
export const EVENT_VALUE_PREFIX = 'on$';
export const DID_VALUE_PREFIX = 'did$';
export const WILL_VALUE_PREFIX = 'will$';
export const HANDLE_VALUE_PREFIX = 'handle$';
// `:for-each`/`:for-data`/`:for-as`/`:for-key` are fixed (non-prefixed)
// attribute names, not open-ended `prefix-name` families like
// class-/style-/on-/did-/will-
export const FOR_EACH_ATTR = 'for-each';
export const FOR_DATA_ATTR = 'for-data';
export const FOR_AS_ATTR = 'for-as';
export const FOR_KEY_ATTR = 'for-key';
export const FOR_EACH_VALUE = 'for$each';
export const FOR_DATA_VALUE = 'for$data';
export const FOR_AS_VALUE = 'for$as';
export const FOR_KEY_VALUE = 'for$key';
// the per-item value's runtime key defaults to this (`:for-as` overrides it);
// it's compiled as an ordinary value, not a `for$`-prefixed one, so bare
// `${data}` references qualify to `this.data` with no special-casing needed
export const FOR_DATA_DEFAULT_NAME = 'data';
// <:define tag="custom-name:base-tag" ...> declares a custom tag; parser
// uppercases tag names, matching how preprocessor.ts's own directive tags
// (IMPORT_DIRECTIVE_TAG etc.) are spelled
export const DEFINE_DIRECTIVE_TAG = DIRECTIVE_TAG_PREFIX + 'DEFINE';
// marks where a <:define> body accepts the children written at a usage
// site; its own content, if any, stands in when a usage supplies none
export const SLOT_DIRECTIVE_TAG = DIRECTIVE_TAG_PREFIX + 'SLOT';
/**
 * `<:logic>`: a scope with no element of its own.
 *
 * Everything else that declares values is markup that happens to carry
 * them, so state with no markup to belong to had to invent an element to
 * live on -- and that element is then real: it is in the document, in the
 * accessibility tree, and in the way of `:first-child` and `* + *`. This
 * language already makes authors write `:first-of-type` because `:for-each`
 * leaves a stencil behind; a `<span>` holding the model would be a second
 * such rule, in the one place the author had no reason to accept one.
 */
export const LOGIC_DIRECTIVE_TAG = DIRECTIVE_TAG_PREFIX + 'LOGIC';
/**
 * The base tag that means "no element": `<:define tag="std-data:logic">`.
 *
 * The same word as `<:logic>` because it is the same thing -- that one is a
 * scope with no element, this one is a tag whose instances are. Spelled out
 * rather than left off, so `tag="my-panel"` goes on being the error it is
 * today instead of quietly meaning something new.
 */
export const LOGIC_BASE_TAG = 'logic';
// `<:slot name="header">`; a slot with no name is the default one, taking
// everything a usage site doesn't address to another
export const SLOT_NAME_ATTR = 'name';
// `<div :slot="header">` at a usage site: which slot this child fills. An
// attribute rather than a wrapper element, so filling a slot doesn't add
// markup a CSS framework would then have to style around
export const SLOT_TARGET_ATTR = 'slot';
export const DEFAULT_SLOT_NAME = '';
export const DEFINE_TAG_ATTR = 'tag';
// internal-only marker stamped on a <:define>'s expanded inner element
// during stage1-load's pre-pass, so the element can be matched back up to
// its custom tag name once its own scope is created; stripped before that
// scope's element is otherwise treated like any other
export const DEFINE_NAME_MARKER = 'data-markout-define';

export class Page {
  source: Source;
  global: Scope;
  /** custom tag name -> its <:define> scope, populated by stage1-load */
  customTags: Map<string, Scope>;
  /**
   * Custom tags a usage site was actually found for, recorded as stage1
   * expands them.
   *
   * Deliberately not derived from `usesTemplate`: a usage that supplies
   * slotted content renders from a per-usage variant of the definition's
   * template, so those ids do not answer "which definitions were used".
   */
  usedTags: Set<string>;
  /**
   * Custom tag name -> the `<template>` its markup was wrapped in.
   *
   * Recorded where that wrapping happens, because it cannot be found
   * afterwards: a template holds its children on a content fragment and
   * nulls their `parentElement`, exactly as a browser does, so there is no
   * walking back up to it.
   */
  defineStencils: Map<string, ServerElement>;
  /** elements carrying `:when-used`, and the tags each waits on */
  whenUsed: Map<ServerElement, string[]>;
  /** the <:define> scopes themselves -- excluded from their parent's
   * compiled children by stage7-generate, since they're never live at
   * their own natural position, only instantiated per usage site */
  definitionScopes: Set<Scope>;
  /**
   * Every `<:logic>` scope, against the tag names it was written inside.
   *
   * Both halves are needed once the tree has settled (stage1's
   * checkLogicPlacement) and neither can be recovered then: the element is
   * gone by design, so its ancestry has to be taken down while it is still
   * there, and whether one of those ancestors is a custom tag is not known
   * until every `<:define>` on the page has been read.
   */
  logicScopes: Map<Scope, string[]>;
  /** custom tags declared `tag="x:logic"`: their instances have no element,
   *  so no stencil is emitted and no usage marker is left for one */
  elementlessTags: Set<string>;
  values: Map<string, Value>;
  /** `:slot` targets, kept aside by stage1 before it strips `:` attributes */
  slotTargets: Map<ServerElement, string>;
  /**
   * Each `:else`/`:else-if` scope against the branch it continues.
   *
   * Recorded while loading, where adjacency can still be read off the
   * markup, and turned into `Scope.elseOf`/`elseNext` links only once the
   * tree has stopped moving -- a custom tag's usage scope is detached and
   * replaced by an instance, so a link taken down any earlier would name a
   * scope the runtime never sees. See stage1's linkElseChains.
   */
  elseChains: Map<Scope, Scope>;
  /**
   * A custom tag usage's loaded scope -> the instance scope standing in for
   * it, as expandCustomTagUsages replaces one with the other.
   *
   * The usage scope keeps its values and its parent link, so it is not
   * simply gone -- which is what makes this needed: anything recorded
   * against it while loading has to be re-pointed at the scope that is
   * actually compiled.
   */
  usageInstances: Map<Scope, Scope>;
  /**
   * A definition's scope against the per-usage copies made of it.
   *
   * A usage that fills a slot gets a stencil of its own, and every scope
   * whose element holds that slot is copied to go with it (rehomeNestedScopes)
   * -- so a definition's inner scope can be one object or twenty, and
   * anything recorded against the one the loader built has to reach all of
   * them. The copies keep the original's `id`, which is what lets a link
   * between two of them go on being written as that id.
   */
  rehomedScopes: Map<Scope, Scope[]>;
  /**
   * The `<template>`s wrapping a `:for-data` rather than a `:for-each`.
   *
   * Both arities are compiled into a stencil, but only one of them is
   * stamped out repeatedly -- and that is what decides whether a `<:slot>`
   * inside can be filled. By the time slots are matched the `:` attributes
   * are long stripped, so the distinction is recorded here as it is made.
   */
  optionalStencils: Set<ServerElement>;
  /** nodes moved into a custom-tag instance's slot -> that instance. A
   * stencil clone isn't in the scope tree, so this is the only way a usage
   * site nested in slotted content can find what it now sits inside */
  slottedInto: Map<object, Scope>;
  main?: Scope;
  errors: PageError[] = [];
  nextValueId = 0;
  nextScopeId = 0;
  /**
   * Names the host supplied to the server -- a database handle, a mailer,
   * whatever the middleware was given.
   *
   * Only the names: the compiler never sees the objects, and never needs to.
   * What it does with them is refuse the two ways a page could get one
   * wrong, both at build time and neither costing the runtime anything --
   * reading one outside a `:server-` value, and declaring a name over one.
   */
  serverGlobals: ReadonlySet<string> = new Set();
  /** the `CoreScopeProps`-shaped ObjectExpression AST generated by stage7, if it ran */
  propsAST?: Node;
  /** `propsAST` serialized to JS source via escodegen: what the SERVER runs */
  propsString?: string;
  /**
   * The same, with every `:server-` expression taken out: what the browser
   * is given, and what the props `<script>` carries.
   *
   * The same string as `propsString` on a page that declares no server
   * value, so nothing pays for this feature without using it.
   */
  clientPropsString?: string;
  /**
   * The empty `<script>` stage7 reserves between the props and the runtime,
   * for the server to fill with this render's `:server-` results.
   *
   * Reserved at compile time rather than inserted afterwards because the
   * position is what matters: the runtime script is `async`, so it may
   * execute the moment it has loaded, and state written after it could
   * arrive too late. Removed again if the render produces nothing to send.
   */
  stateScript?: ServerElement;
  /**
   * Every `<script>` stage7 put in the page: the props, the state one when
   * there is one, and the runtime.
   *
   * Held so a render can stamp a CSP nonce on them. Only markout's OWN
   * scripts are in here -- a `<script>` the page author wrote is theirs to
   * account for in their policy, and silently nonce-ing it would make this
   * middleware the reason an injected script ran.
   */
  bootstrapScripts: ServerElement[] = [];
  /** where `stateScript` stood, if a render took it out for having nothing
   *  to say -- so a later render of the same cached page can put it back */
  stateScriptAt?: { parent: ServerContainerNode; before?: ServerNode };

  constructor(source: Source, global?: Scope) {
    this.source = source;
    this.global = global ?? new Scope(this);
    if (global) {
      global.page = this;
    }
    this.customTags = new Map();
    this.slotTargets = new Map();
    this.elseChains = new Map();
    this.usageInstances = new Map();
    this.rehomedScopes = new Map();
    this.optionalStencils = new Set();
    this.slottedInto = new Map();
    this.definitionScopes = new Set();
    this.logicScopes = new Map();
    this.elementlessTags = new Set();
    this.usedTags = new Set();
    this.defineStencils = new Map();
    this.whenUsed = new Map();
    this.values = new Map();
  }

  /**
   * Record a compile error, unless the same one is already recorded.
   *
   * Same message at the same source position is the same mistake: nothing
   * distinguishes the copies for a reader, so the extras are noise.
   *
   * They arise from a `<:define>` body, which is resolved once on its own and
   * again for each usage site -- the per-usage walks are not redundant (a
   * value written at a call site resolves there, so its dependencies differ
   * per instance), but a reference the body makes to the page's own
   * vocabulary resolves up the DEFINITION's chain every time, and so misses
   * identically every time. A component used ten times reported one typo
   * eleven times.
   */
  addError(msg: string, loc?: acorn.SourceLocation | null) {
    if (this.errors.some(e => e.msg === msg && sameLoc(e.loc, loc))) {
      return;
    }
    this.errors.push(new PageError('error', msg, loc));
  }

  /**
   * Every class name this page can put on an element through a `:class-`
   * toggle, sorted, after imports were resolved and treeshaking dropped what
   * the page never uses.
   *
   * It exists because a toggle is invisible to the tools that generate CSS by
   * reading markup. Tailwind and its kind scan source files for candidate
   * strings, and `:class-bg-brand-600` spells the utility in the attribute
   * NAME -- so what a scanner reads is `class-bg-brand-600`, which is not a
   * utility. Nothing is generated, and the page then compiles clean, runs
   * clean, puts the class on, and looks unchanged. Measured: the Tailwind
   * demo lost every one of its toggled utilities on its first build.
   *
   * Everything else on a page is already found, because a scanner reads raw
   * text: a literal in `class="..."`, in `${'italic'}`, in either branch of a
   * ternary, or in a value read into `class` from elsewhere. So this reports
   * TOGGLES ONLY -- listing the rest would be bytes buying nothing.
   *
   * Read off the scope tree rather than the markup, which is what makes it
   * worth asking the compiler for at all: the tree is post-`<:import>`, so a
   * kit's toggles are in here without the caller knowing which kit, and
   * post-treeshake, so an unused definition's are not. A regex over the
   * sources gets neither, and gets to disagree with this compiler about what
   * a toggle is -- two implementations of one rule, which is a shape this
   * project keeps a list of. See docs/design/tailwind-support.md.
   */
  classNames(): string[] {
    const found = new Set<string>();
    const walk = (scope: Scope) => {
      for (const name of scope.values.keys()) {
        name.startsWith(CLASS_VALUE_PREFIX) &&
          found.add(name.slice(CLASS_VALUE_PREFIX.length));
      }
      scope.children.forEach(walk);
    };
    walk(this.global);
    return [...found].sort();
  }

  createValueId() {
    return `v${this.nextValueId++}`;
  }

  createScopeId() {
    return `s${this.nextScopeId++}`;
  }
}

/**
 * Whether two errors point at the same place.
 *
 * Position rather than object identity: the copies come from separate walks
 * over separate clones of one `<:define>` body, so they are never the same
 * `loc`. Two errors with no location at all are the same place too -- there
 * is nothing to tell them apart by, which is exactly when a duplicate is
 * least useful to read.
 */
function sameLoc(a?: acorn.SourceLocation | null, b?: acorn.SourceLocation | null) {
  if (!a || !b) {
    return !a && !b;
  }
  return (
    (a.source ?? null) === (b.source ?? null) &&
    a.start.line === b.start.line &&
    a.start.column === b.start.column &&
    a.end.line === b.end.line &&
    a.end.column === b.end.column
  );
}
