import { generate } from 'escodegen';
import type {
  Expression,
  NewExpression,
  Node,
  ObjectExpression,
  Property,
} from 'estree';
import {
  ServerComment,
  ServerElement,
  ServerNode,
  ServerTemplateElement,
  ServerText,
} from '../../html/server-dom';
import { NodeType } from '../../html/dom';
import { DEV_GLOBAL, PROPS_GLOBAL } from '../../runtime/core/core-context';
import {
  EVENT_VALUE_PREFIX,
  REGION_STENCIL_MARKER,
  TEXT_VALUE_PREFIX,
} from '../ir/Page';
import {
  DOM_ID_ATTR,
  DOM_REGION_MARKER,
  DOM_STENCIL_ATTR,
  DOM_STENCIL_ONCE_ATTR,
  DOM_USE_MARKER,
} from '../../runtime/web/web-context';
import type { Page } from '../ir/Page';
import type { Scope } from '../ir/Scope';
import type { Value, ValueDepRef } from '../ir/Value';

// stage1's compiled prefixes don't all match what WebScope.newValue expects;
// translate the ones that differ (class$/style$ already match).
const RUNTIME_KEY_PREFIX_MAP: [string, string][] = [
  [EVENT_VALUE_PREFIX, 'event$'],
  [TEXT_VALUE_PREFIX, 'text$'],
];

/**
 * Where every page, served or built, looks for the browser runtime.
 *
 * It was `/.markout.js` once, on the reasoning that a dot reads as a reserved
 * path rather than as site content -- which is true while the middleware
 * ANSWERS the path, since then it is never a file at all. It stops being true
 * the moment a page is built ahead of time: the path becomes a real file on
 * somebody else's host, and a dot is what hosts use to decide a file is not
 * for publishing. GitHub Pages runs Jekyll, which drops dotfiles unless a
 * `.nojekyll` sits beside them, and denying dot-paths is common server
 * hardening -- so the runtime would 404 on every page of exactly the hosts
 * ahead-of-time delivery exists for, with the markup looking perfectly fine.
 *
 * One name for both modes, and it matches the bundle's own filename on disk
 * (`dist/markout-runtime.js`). Distinctive enough to be worth its length: the
 * middleware answers this path before the filesystem is consulted, so a
 * page of real content here would be shadowed -- which `markout()` warns
 * about at startup, and `build` refuses outright.
 */
export const DEFAULT_RUNTIME_SRC = '/markout-runtime.js';

/**
 * Stage 7: Generate a `CoreScopeProps`-shaped `ObjectExpression` AST for the
 * root scope (`page.propsAST`), and its escodegen-serialized source
 * (`page.propsString`) — ready to write out and load elsewhere as
 * `new CoreContext({ root: <the object>, ... })`.
 *
 * For now every value compiles to `exp` (never `val`), even constants —
 * that optimization is left for later. This stage is pure codegen: it
 * doesn't execute any user expression (that's stage5-comptime's concern,
 * if/when it exists).
 *
 * Also appends two bootstrap `<script>` tags at the end of `<body>`: one
 * sets `window[PROPS_GLOBAL]` to the generated props, the other loads the
 * runtime asynchronously — which, once loaded, autonomously initializes
 * itself from that global (no explicit entry-point call needed).
 */

export function stage7generate(
  page: Page,
  runtimeSrc = DEFAULT_RUNTIME_SRC,
  dev = false,
  classManifest = false
) {
  relocateStencils(page);
  classManifest && injectClassManifest(page);
  const root = page.global.children[0];
  if (root) {
    page.propsAST = generateScope(root, false);
    unwrapRegexLiterals(page.propsAST);
    page.propsString = generate(page.propsAST, codegenOptions(dev));
    // The browser gets a different copy, with every `:server-` expression
    // taken out of it. Two reasons, and the first is the serious one:
    //
    //  - a server expression is the one thing on the page written to run
    //    where the visitor cannot see. `${db.orders.forUser(id)}` in the
    //    served source publishes the query, the table names and the shape of
    //    an internal API to anyone who opens View Source, for code the
    //    browser was never going to run.
    //  - it could not run it anyway. The client builds these values from the
    //    result the server sent; falling back to an expression that reaches
    //    for something only the server has can only throw. Absent a result,
    //    `undefined` is the honest answer -- and the one every other failure
    //    in this language already gives.
    //
    // Only generated a second time when there is something to take out, so a
    // page with no server value pays nothing and produces what it always did.
    const hasServerValues = [...page.values.values()].some(v => v.serverOnly);
    let clientAST: ObjectExpression | undefined;
    if (hasServerValues) {
      clientAST = generateScope(root, true);
      unwrapRegexLiterals(clientAST);
    }
    page.clientPropsString = clientAST
      ? generate(clientAST, codegenOptions(dev))
      : page.propsString;
    injectBootstrapScripts(page, runtimeSrc, dev);
  }
  return page;
}

/**
 * Readable props in dev, compact ones otherwise.
 *
 * escodegen indents and line-breaks by default, and the props are almost
 * entirely small functions -- a dependency is
 * `function () {\n    return this.$value('rows');\n}`, which is 145 bytes of
 * which about 25 say anything. On Orbit's 305 scopes that is 1495KB
 * pretty-printed against 300KB compact, 53KB against 24KB gzipped: four
 * fifths of the page is indentation.
 *
 * Kept readable under `--dev` because that is where someone opens the props
 * to see what the compiler made of their page, and a single line 300KB long
 * is not that.
 */
function codegenOptions(dev: boolean) {
  return dev ? undefined : { format: { compact: true } };
}

/**
 * Moves every region stencil to `<head>`, leaving a marker comment behind.
 *
 * A `:if`, `:else`, `:for-data` or `:for-each` is compiled into a
 * `<template>` holding the markup it renders from. Written where the
 * element was, that template is an element like any other: `:nth-child`
 * counts it, `:first-child` never matches the first replica, `:empty` is
 * false for a container holding only a stencil -- and inside `<svg>` there
 * is no HTML `<template>` at all, so the whole mechanism breaks. Nested in a
 * `:for-each`, it is also copied into every replica along with everything
 * it holds.
 *
 * So the markup goes to `<head>` and a comment holds the place, exactly as
 * an interpolation and a custom-tag usage site already do. See
 * docs/design/stencil-placement.md.
 *
 * The marker says both things the runtime needs: whose region this is, and
 * which stencil it renders from -- `-c<scopeId>.<stencilKey>`. Two ids
 * rather than one because they answer different questions. A scope id is
 * unique only among its container's descendants, which is what lets one
 * marker stand in every replica; a stencil key is unique in the document,
 * because a `<:define>` body is cloned per usage site that fills a slot and
 * those copies keep the scope ids they were made from.
 *
 * Runs here, after every compile-time walk that reasons about being inside
 * a stencil, so none of them has to learn a second arrangement.
 */
function relocateStencils(page: Page) {
  const doc = page.source.doc;
  const head = doc.head ?? doc.documentElement;
  if (!head) return;
  // collected before anything moves, so nesting is still readable: a
  // stencil inside another one may be instantiated many times over, which
  // is the difference between a spent stencil and one still needed. And so
  // is the namespace it was written in, which nothing about the template
  // itself records
  const found: {
    template: ServerTemplateElement;
    nested: boolean;
    foreign?: string;
  }[] = [];
  const walk = (e: ServerElement, nested: boolean, foreign?: string) => {
    const container = e.tagName === 'TEMPLATE' ? (e as ServerTemplateElement).content : e;
    const inStencil = nested || e.tagName === 'TEMPLATE';
    // <foreignObject> is the door back out of SVG: what is written in there
    // is HTML again, and wrapping it would put it back in the wrong one
    const within = FOREIGN_ROOT_TAGS.has(e.tagName)
      ? e.tagName.toLowerCase()
      : e.tagName === FOREIGN_ESCAPE_TAG
        ? undefined
        : foreign;
    for (const child of [...container.childNodes]) {
      if (child.nodeType !== NodeType.ELEMENT) continue;
      const el = child as ServerElement;
      el.getAttribute(REGION_STENCIL_MARKER) !== null &&
        found.push({ template: el as ServerTemplateElement, nested: inStencil, foreign: within });
      walk(el, inStencil, within);
    }
  };
  walk(doc, false);

  for (const { template, nested, foreign } of found) {
    const scopeId = stencilScopeId(template);
    const parent = template.parentNode;
    // an empty stencil belongs to nothing: `<x-logic :for-each>` names a tag
    // whose instances have no element, so the usage left no marker for one.
    // Nothing renders from it and nothing can look for it
    if (scopeId === undefined || !parent) continue;
    const once = `${template.getAttribute(REGION_STENCIL_MARKER)}` === 'once';
    const key = page.createStencilId();
    template.removeAttribute(REGION_STENCIL_MARKER);
    template.setAttribute(DOM_STENCIL_ATTR, key, template.loc);
    // only where it can be acted on: a stencil standing inside another is
    // stamped out once per instance of that one, so no single rendering
    // ever spends it
    once && !nested && template.setAttribute(DOM_STENCIL_ONCE_ATTR, null, template.loc);
    foreign && wrapForeignContent(template, foreign);
    parent.insertBefore(
      new ServerComment(doc, `${DOM_REGION_MARKER}${scopeId}.${key}`, template.loc),
      template
    );
    parent.removeChild(template);
    head.appendChild(template);
    page.regionStencils.push(template);
  }
}

/** the two namespaces an HTML document can switch into, and the way back */
const FOREIGN_ROOT_TAGS = new Set(['SVG', 'MATH']);
const FOREIGN_ESCAPE_TAG = 'FOREIGNOBJECT';

/**
 * Re-roots a stencil's markup under the element that names its namespace.
 *
 * `<circle>` means an SVG circle inside `<svg>` and an unknown HTML element
 * anywhere else, and a stencil in <head> is anywhere else. Served as
 * `<template><circle/></template>` the browser parses it into the HTML
 * namespace, and the clone this makes renders nothing at all -- which is
 * the failure this whole file exists to avoid, since nothing throws and
 * nothing is reported.
 *
 * So the markup travels with an `<svg>` (or `<math>`) around it, which is
 * exactly what tells the parser where it belongs. Nothing else changes:
 * the region's own element is found inside the stencil by its id, wrapper
 * or no wrapper, and the wrapper itself is never cloned.
 */
function wrapForeignContent(template: ServerTemplateElement, tag: string): void {
  const doc = template.ownerDocument;
  const root = new ServerElement(doc, tag, template.loc);
  for (const child of [...template.content.childNodes]) {
    (child as ServerNode).unlink();
    root.appendChild(child);
  }
  template.appendChild(root);
}

/**
 * Whose region a stencil holds, read off the markup rather than the scopes.
 *
 * The element it wraps carries the id, except when the region is a custom
 * tag: expandCustomTagUsages has replaced that element with the usage
 * marker naming the instance's scope, and the element itself does not exist
 * until the runtime stamps it out.
 *
 * Read from the markup because the scope cannot be looked up: a usage
 * instance has no element to match against, and a definition's copies share
 * the id of the scope they were copied from -- so neither an element nor an
 * id identifies one scope here. The markup is the only thing that is
 * already one-to-one with the stencil.
 */
function stencilScopeId(template: ServerTemplateElement): string | undefined {
  for (const n of template.content.childNodes) {
    if (n.nodeType === NodeType.ELEMENT) {
      const id = (n as ServerElement).getAttribute(DOM_ID_ATTR);
      if (id !== null) return `${id}`;
    }
    if (n.nodeType === NodeType.COMMENT) {
      const text = `${(n as ServerComment).textContent}`;
      if (text.startsWith(DOM_USE_MARKER)) return text.slice(DOM_USE_MARKER.length);
    }
  }
  return undefined;
}

/**
 * Append a `<template>` naming every class the page can wear through a
 * `:class-` toggle, so a CSS generator reading the output finds them.
 *
 * The problem it answers is in Page.classNames(): a toggle spells its utility
 * in the attribute name, where no scanner looks. This says the same names in
 * the one place every scanner does look -- a `class` attribute holding string
 * literals.
 *
 * A `<template>` because its content is inert: parsed into a DocumentFragment
 * rather than the live DOM, so nothing is styled, laid out, or announced. And
 * because markout itself is finished with the page by the time this runs, so
 * nothing here compiles, binds or renders.
 *
 * Toggles only, and nothing when there are none -- a page without one is
 * byte-for-byte what it was before this existed. The weight when there are:
 * every distinct toggle in the whole Bootstrap kit is 35 names, 444 bytes
 * before gzip, and they compress well because most of those strings already
 * appear elsewhere in the same document.
 *
 * Named for the page rather than for a vendor. A page declaring the classes
 * it can wear is a fact about the page; it happens to be what Tailwind,
 * UnoCSS and Panda all need, and knowing about any of them is not this
 * compiler's business. See docs/design/tailwind-support.md.
 */
function injectClassManifest(page: Page) {
  const doc = page.source.doc;
  const body = doc.body;
  const names = page.classNames();
  if (!body || !names.length) {
    return;
  }
  const template = doc.createElement('template');
  template.setAttribute('data-markout-classes', null, body.loc);
  const div = doc.createElement('div');
  div.setAttribute('class', names.join(' '), body.loc);
  template.appendChild(div);
  body.appendChild(template);
}

function injectBootstrapScripts(page: Page, runtimeSrc: string, dev: boolean) {
  const doc = page.source.doc;
  const body = doc.body;
  if (!body || !page.clientPropsString) {
    return;
  }

  const propsScript = doc.createElement('script');
  propsScript.appendChild(
    new ServerText(
      doc,
      `window.${PROPS_GLOBAL} = ${escapeScriptClose(page.clientPropsString)};` +
        // tells the browser runtime to surface expression errors in the page
        // the same way SSR just did, instead of only logging them
        (dev ? `window.${DEV_GLOBAL} = true;` : ''),
      body.loc,
      false
    )
  );
  body.appendChild(propsScript);
  page.bootstrapScripts.push(propsScript);

  // reserved here, filled by the server once its render has settled -- see
  // Page.stateScript for why the position is decided at compile time. Only
  // when something will actually go in it: a page declaring no `:server-`
  // value should be byte-for-byte what it was before this existed
  if ([...page.values.values()].some(value => value.serverOnly)) {
    page.stateScript = doc.createElement('script');
    body.appendChild(page.stateScript);
    page.bootstrapScripts.push(page.stateScript);
  }

  const runtimeScript = doc.createElement('script');
  runtimeScript.setAttribute('src', runtimeSrc, body.loc);
  runtimeScript.setAttribute('async', null, body.loc);
  body.appendChild(runtimeScript);
  page.bootstrapScripts.push(runtimeScript);
}

// a literal `</script` inside generated source (e.g. from a string a user
// wrote in a template expression) would otherwise close the tag early, and
// `<!--` opens a legacy comment inside which the parser stops recognizing
// the closing tag at all. Deliberately duplicated in server/serialize.ts
// rather than shared: that copy escapes bytes from outside the page, so it
// is a security boundary and belongs with the code that produces them.
function escapeScriptClose(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

/**
 * Rewrites `/<!--x/u` into `new RegExp("<!--x", "u")`, so that the escaper
 * above only ever meets those bytes inside a string.
 *
 * `escapeScriptClose` works on generated TEXT and so cannot see what its
 * matches are inside. In a string literal both of its replacements are
 * harmless -- `"<\\!--"` is `"<!--"`, since an unknown escape in a string is
 * the character itself. In a REGEX literal the same rewrite is a syntax
 * error under `u` or `v`, where identity escapes are exactly what those
 * flags took away. And the cost of one syntax error here is the whole props
 * blob: the script does not parse, so the page keeps its server-rendered
 * markup and loses every binding it has, with nothing reported anywhere.
 *
 * Moving the pattern into a string argument puts the bytes back in the
 * context the escaper was written for. Confined to a pattern that actually
 * contains `<`, so the output of every page that has no such regex -- which
 * is nearly all of them -- is byte-for-byte what it was.
 *
 * The AST is walked generically rather than by node type: a regex can appear
 * anywhere an expression can, and this pass only cares about one leaf.
 */
function unwrapRegexLiterals(node: unknown): void {
  if (!node || typeof node !== 'object') {
    return;
  }
  // Object.keys covers arrays too, whose indices assign back just as well
  const container = node as Record<string, unknown>;
  for (const key of Object.keys(container)) {
    const child = container[key];
    const constructed = regexAsConstructor(child);
    if (constructed) {
      container[key] = constructed;
    } else {
      unwrapRegexLiterals(child);
    }
  }
}

function regexAsConstructor(node: unknown): NewExpression | undefined {
  if (!node || typeof node !== 'object') {
    return undefined;
  }
  const literal = node as {
    type?: string;
    regex?: { pattern: string; flags: string };
    value?: unknown;
  };
  if (literal.type !== 'Literal') {
    return undefined;
  }
  // acorn carries `regex` alongside the compiled value; the value alone is
  // enough where a pass upstream built the node by hand
  const regex =
    literal.regex ??
    (literal.value instanceof RegExp
      ? { pattern: literal.value.source, flags: literal.value.flags }
      : undefined);
  if (!regex || !regex.pattern.includes('<')) {
    return undefined;
  }
  return {
    type: 'NewExpression',
    callee: { type: 'Identifier', name: 'RegExp' },
    arguments: [
      { type: 'Literal', value: regex.pattern },
      { type: 'Literal', value: regex.flags },
    ],
  };
}

function generateScope(scope: Scope, forClient: boolean): ObjectExpression {
  const valueProps: Property[] = [];
  for (const [name, value] of scope.values) {
    valueProps.push(
      valueProperty(
        toRuntimeKey(name),
        generateValueProps(value, scope.callSiteValues?.has(name), forClient)
      )
    );
  }
  for (const [name, value] of scope.textValues) {
    valueProps.push(
      valueProperty(
        toRuntimeKey(name),
        generateValueProps(value, scope.callSiteValues?.has(name), forClient)
      )
    );
  }

  const props: Property[] = [property('id', literal(scope.id))];
  if (scope.name) {
    props.push(property('name', literal(scope.name)));
  }
  if (scope.slotted) {
    // written at a usage site, living inside the instance: the runtime
    // resolves its names from outside rather than from the definition
    props.push(property('slotted', literal(true)));
  }
  if (scope.slottedText) {
    // holds text written at a usage site: that text resolves out at the
    // instance's call site, while everything else here resolves against the
    // definition (see CoreScope.hostFor)
    props.push(property('slottedText', literal(true)));
  }
  if (scope.elseOf) {
    // an `:else`/`:else-if`: which branch it continues, and which continues
    // it. Emitted only for a chain, so a lone `:if` carries neither and the
    // runtime's fast path stays the only path it takes
    props.push(property('elseOf', literal(scope.elseOf.id)));
  }
  if (scope.elseNext) {
    props.push(property('elseNext', literal(scope.elseNext.id)));
  }
  if (scope.usesTemplate) {
    // a custom-tag usage instance: WebScope instantiates its DOM from the
    // named <:define> stencil if no already-rendered element is found
    props.push(property('template', literal(scope.usesTemplate)));
  }
  if (scope.attributes?.size) {
    props.push(
      property(
        'attributes',
        objectExpression(
          [...scope.attributes].map(([name, value]) => valueProperty(name, literal(value ?? '')))
        )
      )
    );
  }
  props.push(property('values', objectExpression(valueProps)));
  // a <:define> scope is never itself live at its own (natural, nested)
  // position -- only usage-site instances of it are, elsewhere in the tree
  const children = scope.children.filter(child => !scope.page.definitionScopes.has(child));
  props.push(
    property('children', arrayExpression(children.map(c => generateScope(c, forClient))))
  );

  return objectExpression(props);
}

function generateValueProps(
  value: Value,
  callSite?: boolean,
  forClient?: boolean
): ObjectExpression {
  if (forClient && value.serverOnly) {
    // the mark and nothing else: the client reads its result out of the
    // page's state, and has neither the expression nor the dependency edges
    // that would let it try to produce one of its own. Absent a result the
    // value is simply `undefined` -- see stage7generate for why that is the
    // wanted outcome rather than a lost fallback
    return objectExpression([property('serverOnly', literal(true))]);
  }
  // split, because the two halves make different promises to the runtime:
  // an ordinary dependency must resolve, and one that walks into a region
  // is allowed not to while that region is away. See CoreValueProps.maybeDeps
  const maybes = value.deps.filter(d => d.maybe);
  const props = [
    property('exp', functionExpression(generateExpBody(value))),
    property('deps', arrayExpression(value.deps.filter(d => !d.maybe).map(makeDep))),
  ];
  if (maybes.length) {
    props.push(property('maybeDeps', arrayExpression(maybes.map(makeMaybeDep))));
  }
  // written at a custom-tag usage site: evaluated against the scope the tag
  // was written in, not against the instance (see CoreScope.newValue)
  callSite && props.push(property('callSite', literal(true)));
  // `:server-`: the server collects this value after rendering and sends the
  // result, which the client uses instead of running `exp` (see CoreContext)
  value.serverOnly && props.push(property('serverOnly', literal(true)));
  return objectExpression(props);
}

function generateExpBody(value: Value): Expression {
  const expression = value.value;
  if (expression == null) {
    // a presence-only attribute (e.g. bare `:class-active`) implies `true`
    return literal(true);
  }
  if (typeof expression === 'string') {
    // a plain (non-`${}`) value is a static literal, not an expression
    return literal(expression);
  }
  return expression as unknown as Expression;
}

const RT_HOST_KEY = '$host';

function makeDep(dep: ValueDepRef): Expression {
  // `function () { return this.$value("key"); }` or, through one or more
  // scope navigations, `function () { return this.<via>...$value("key"); }`
  // -- each `via` segment is a plain property (either $parent, $host, or a
  // named child scope's :aka name), unlike $value which is called with the key
  let scope: Expression = { type: 'ThisExpression' } as unknown as Expression;
  for (const segment of dep.via ?? []) {
    scope = memberExpression(scope, identifier(segment));
  }
  const target = memberExpression(scope, identifier('$value'));
  const call = callExpression(target, [literal(dep.key)]);
  if (!dep.via?.includes(RT_HOST_KEY)) {
    return functionExpression(call);
  }
  // `$host` is the one navigation that legitimately arrives nowhere: a
  // component standing on its own has no enclosing instance. The runtime
  // treats a dependency that resolves to nothing as a compiler bug, and it
  // is right to -- so this one falls back to `$host` itself, which is on
  // every scope and never changes. Inside a host it depends on what it
  // reads; outside one it depends on a constant, which is what "there is
  // nothing there to watch" should cost
  return functionExpression(
    logicalExpression(
      '??',
      optionalCall(scope, dep.key),
      callExpression(
        memberExpression({ type: 'ThisExpression' } as unknown as Expression, identifier('$value')),
        [literal(RT_HOST_KEY)]
      )
    )
  );
}

/**
 * The same, for a reference that walked into a region: optional at every step.
 *
 * `function () { return this?.a?.b?.$value("key"); }` -- so a scope that is
 * not there while its region is away answers `undefined` rather than throwing
 * on the way to it. The page wrote `?.` to be allowed this; the codegen is
 * that `?.`, applied to the navigation the author never sees.
 */
function makeMaybeDep(dep: ValueDepRef): Expression {
  let scope: Expression = { type: 'ThisExpression' } as unknown as Expression;
  for (const segment of dep.via ?? []) {
    scope = {
      type: 'MemberExpression',
      object: scope,
      property: identifier(segment),
      computed: false,
      optional: true,
    } as unknown as Expression;
  }
  return functionExpression(optionalCall(scope, dep.key));
}

/** `<scope>?.$value("key")` */
function optionalCall(scope: Expression, key: string): Expression {
  return {
    type: 'ChainExpression',
    expression: {
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        object: scope,
        property: identifier('$value'),
        computed: false,
        optional: true,
      },
      arguments: [literal(key)],
      optional: false,
    },
  } as unknown as Expression;
}

function logicalExpression(operator: string, left: Expression, right: Expression): Expression {
  return { type: 'LogicalExpression', operator, left, right } as unknown as Expression;
}

function toRuntimeKey(name: string): string {
  const prefix = RUNTIME_KEY_PREFIX_MAP.find(([from]) => name.startsWith(from));
  return prefix ? prefix[1] + name.slice(prefix[0].length) : name;
}

// ===========================================================================
// small AST builders
// ===========================================================================

function objectExpression(properties: Property[]): ObjectExpression {
  return { type: 'ObjectExpression', properties } as unknown as ObjectExpression;
}

function arrayExpression(elements: Node[]): Expression {
  return { type: 'ArrayExpression', elements } as unknown as Expression;
}

function property(name: string, value: Expression | ObjectExpression): Property {
  return {
    type: 'Property',
    key: identifier(name),
    value,
    kind: 'init',
    method: false,
    shorthand: false,
    computed: false,
  } as unknown as Property;
}

// scope value names (class$/style$/on$ suffixes, in particular) may contain
// dashes -- not valid bare identifiers -- so always quote them; escodegen
// prints an Identifier key as-is without validation, which would otherwise
// emit syntactically broken source (e.g. `on$item-selected: ...`)
function valueProperty(name: string, value: Expression | ObjectExpression): Property {
  return {
    type: 'Property',
    key: literal(name),
    value,
    kind: 'init',
    method: false,
    shorthand: false,
    computed: false,
  } as unknown as Property;
}

function identifier(name: string): Expression {
  return { type: 'Identifier', name } as unknown as Expression;
}

function literal(value: string | number | boolean): Expression {
  return { type: 'Literal', value } as unknown as Expression;
}

function callExpression(callee: Expression, args: Expression[]): Expression {
  return { type: 'CallExpression', callee, arguments: args, optional: false } as unknown as Expression;
}

function memberExpression(object: Expression, prop: Expression): Expression {
  return {
    type: 'MemberExpression',
    object,
    property: prop,
    computed: false,
    optional: false,
  } as unknown as Expression;
}

function thisMember(name: string): Expression {
  return memberExpression({ type: 'ThisExpression' } as unknown as Expression, identifier(name));
}

// the wrapper must be a plain `function`, never an arrow: CoreValue.get()
// calls it via `.apply(scope.proxy)`, which only a plain function honors
function functionExpression(returned: Expression): Expression {
  return {
    type: 'FunctionExpression',
    id: null,
    params: [],
    generator: false,
    async: false,
    body: {
      type: 'BlockStatement',
      body: [{ type: 'ReturnStatement', argument: returned }],
    },
  } as unknown as Expression;
}

