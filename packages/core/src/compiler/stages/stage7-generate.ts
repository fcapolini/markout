import { generate } from 'escodegen';
import type { Expression, Node, ObjectExpression, Property } from 'estree';
import { ServerText } from '../../html/server-dom';
import { DEV_GLOBAL, PROPS_GLOBAL } from '../../runtime/core/core-context';
import { EVENT_VALUE_PREFIX, TEXT_VALUE_PREFIX } from '../ir/Page';
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
  dev = false
) {
  const root = page.global.children[0];
  if (root) {
    page.propsAST = generateScope(root, false);
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
    page.clientPropsString = hasServerValues
      ? generate(generateScope(root, true), codegenOptions(dev))
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

  // reserved here, filled by the server once its render has settled -- see
  // Page.stateScript for why the position is decided at compile time. Only
  // when something will actually go in it: a page declaring no `:server-`
  // value should be byte-for-byte what it was before this existed
  if ([...page.values.values()].some(value => value.serverOnly)) {
    page.stateScript = doc.createElement('script');
    body.appendChild(page.stateScript);
  }

  const runtimeScript = doc.createElement('script');
  runtimeScript.setAttribute('src', runtimeSrc, body.loc);
  runtimeScript.setAttribute('async', null, body.loc);
  body.appendChild(runtimeScript);
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

