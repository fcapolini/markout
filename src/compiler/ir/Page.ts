import { PageError, Source } from '../../html/parser';
import type { ServerElement } from '../../html/server-dom';
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
// `:for-each`/`:for-as`/`:for-key` are fixed (non-prefixed) attribute names,
// not open-ended `prefix-name` families like class-/style-/on-/did-/will-
export const FOR_EACH_ATTR = 'for-each';
export const FOR_AS_ATTR = 'for-as';
export const FOR_KEY_ATTR = 'for-key';
export const FOR_EACH_VALUE = 'for$each';
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
  /** the <:define> scopes themselves -- excluded from their parent's
   * compiled children by stage7-generate, since they're never live at
   * their own natural position, only instantiated per usage site */
  definitionScopes: Set<Scope>;
  values: Map<string, Value>;
  /** `:slot` targets, kept aside by stage1 before it strips `:` attributes */
  slotTargets: Map<ServerElement, string>;
  /** nodes moved into a custom-tag instance's slot -> that instance. A
   * stencil clone isn't in the scope tree, so this is the only way a usage
   * site nested in slotted content can find what it now sits inside */
  slottedInto: Map<object, Scope>;
  main?: Scope;
  errors: PageError[] = [];
  nextValueId = 0;
  nextScopeId = 0;
  /** the `CoreScopeProps`-shaped ObjectExpression AST generated by stage7, if it ran */
  propsAST?: Node;
  /** `propsAST` serialized to JS source via escodegen */
  propsString?: string;

  constructor(source: Source, global?: Scope) {
    this.source = source;
    this.global = global ?? new Scope(this);
    if (global) {
      global.page = this;
    }
    this.customTags = new Map();
    this.slotTargets = new Map();
    this.slottedInto = new Map();
    this.definitionScopes = new Set();
    this.values = new Map();
  }

  createValueId() {
    return `v${this.nextValueId++}`;
  }

  createScopeId() {
    return `s${this.nextScopeId++}`;
  }
}
