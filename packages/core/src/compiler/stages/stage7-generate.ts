import fs from 'fs';
import path from 'path';
import { generate } from 'escodegen';
import type {
  Expression,
  NewExpression,
  Node,
  ObjectExpression,
  Property,
} from 'estree';
import { parseDeclarations } from '../../html/css';
import {
  ServerComment,
  ServerElement,
  ServerNode,
  ServerTemplateElement,
  ServerText,
} from '../../html/server-dom';
import { GROUP_DIRECTIVE_TAG, NodeType } from '../../html/dom';
import { DEV_GLOBAL, LOCS_GLOBAL, PROPS_DATA_ATTR, PROPS_GLOBAL } from '../../runtime/core/core-context';
import { DOM_REGION_END_MARKER } from '../../runtime/web/web-context';
import {
  EVENT_VALUE_PREFIX,
  REGION_STENCIL_MARKER,
  SET_OPERATOR_ATTRS,
  SET_OPERATOR_MAP_ATTR,
  TEXT_VALUE_PREFIX,
} from '../ir/Page';
import {
  DOM_ID_ATTR,
  DOM_REGION_MARKER,
  DOM_STENCIL_ATTR,
  DOM_STENCIL_ONCE_ATTR,
  DOM_USE_MARKER,
} from '../../runtime/web/web-context';
import type { CompiledProps, Page } from '../ir/Page';
import type { Scope } from '../ir/Scope';
import { RT_SCOPE_PARAM } from './stage3-qualify';
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
 * Stage 7: Generate the props a page carries (`page.propsString`) -- the
 * expressions as an array of JavaScript, and a `CoreScopeProps`-shaped tree
 * of data referring to them by index, ready to load elsewhere as
 * `new CoreContext({ root: <the tree>, exps: <the array>, ... })`.
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
  classManifest = false,
  generator = true
) {
  // first, so it lands at the end of the head the AUTHOR wrote rather than
  // after however many stencils the page turns out to need
  generator && injectGenerator(page);
  relocateStencils(page);
  classManifest && injectClassManifest(page);
  tidyBlankLines(page);
  const root = page.global.children[0];
  if (root) {
    page.props = emitProps(root, false, dev);
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
    page.clientProps = hasServerValues ? emitProps(root, true, dev) : page.props;
    injectBootstrapScripts(page, runtimeSrc, dev);
  }
  // last, and after the props have been read off the scopes: from here on
  // a group region is markers and markup, exactly as a browser sees it
  unwrapGroups(page);
  return page;
}

/**
 * Takes every surviving `<:group>` out of the tree, leaving its children.
 *
 * A group region's tag is not markup -- `<:group>` is not a name an HTML
 * parser accepts, and would come back as text -- so what a browser holds
 * between the region's two markers is the children alone. The rendering
 * side has to hold the same thing, or the two disagree about what a scope's
 * territory contains: the tag carries a scope id, `lookupWithin` declines
 * to descend into another scope's element, and a region nested inside this
 * one then cannot find its own marker. That is exactly what a nested group
 * did -- it rendered empty on the server and appeared on hydration.
 *
 * After emitProps, which reads the tag off the scope to know it is a group,
 * and after relocateStencils, which reads it to know the region needs an
 * end marker. Both are done by now, and nothing downstream wants the tag.
 */
function unwrapGroups(page: Page): void {
  const walk = (e: ServerElement): void => {
    const container = e.tagName === 'TEMPLATE' ? (e as ServerTemplateElement).content : e;
    for (const child of [...container.childNodes]) {
      if (child.nodeType !== NodeType.ELEMENT) continue;
      const el = child as ServerElement;
      walk(el);
      if (el.tagName !== GROUP_DIRECTIVE_TAG) continue;
      for (const inner of [...el.childNodes]) {
        el.removeChild(inner);
        container.insertBefore(inner, el);
      }
      container.removeChild(el);
    }
  };
  const root = page.source.doc.documentElement;
  root && walk(root);
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
 * Elements whose whitespace is their content, and must not be touched.
 *
 * `<pre>` and `<textarea>` render it; `<script>` and `<style>` are somebody
 * else's language, where a removed line moves every line number after it and
 * a template literal is text a page can see.
 */
const WHITESPACE_KEPT_TAGS = new Set([
  'PRE',
  'TEXTAREA',
  'SCRIPT',
  'STYLE',
  'LISTING',
  'PLAINTEXT',
  'XMP',
]);

/**
 * Closes up the blank lines compiling a page leaves behind.
 *
 * An `<:import>`, a `<:define>`, a `<:logic>` or a region's markup is taken
 * out of the tree, and the whitespace that was indenting it stays -- so a
 * head with four imports in it serves four lines holding nothing but
 * spaces, and the ones either side of a removed element arrive as SEPARATE
 * text nodes, which is why they stack rather than merge.
 *
 * The rule is one sentence: **where nothing but whitespace lies between two
 * nodes, at most one line break survives**, and the indentation of the line
 * that follows is kept. Runs of adjacent whitespace-only text nodes are
 * considered together, because that is the shape a removal leaves.
 *
 * It cannot change what a page renders. Between block elements this is
 * invisible; between inline ones a run of whitespace has always collapsed to
 * one space and it still does, because a break is left. The exception is
 * `white-space: pre` on ordinary markup, which is CSS and so is not
 * something this can see -- the HTML elements that preserve whitespace are
 * skipped by name.
 *
 * Static whitespace only. An interpolation's text node holds an expression
 * rather than a string until something renders it, which is exactly what
 * tells the two apart here.
 */
function tidyBlankLines(page: Page) {
  const walk = (e: ServerElement) => {
    if (WHITESPACE_KEPT_TAGS.has(e.tagName)) {
      return;
    }
    const container =
      e.tagName === 'TEMPLATE' ? (e as ServerTemplateElement).content : e;
    const nodes = [...container.childNodes] as ServerNode[];
    let run: ServerText[] = [];
    const close = () => {
      if (run.length) {
        collapse(run);
        run = [];
      }
    };
    for (const n of nodes) {
      if (n.nodeType === NodeType.TEXT && isBlankText(n as ServerText)) {
        run.push(n as ServerText);
        continue;
      }
      close();
      n.nodeType === NodeType.ELEMENT && walk(n as ServerElement);
    }
    close();
  };
  page.source.doc.documentElement && walk(page.source.doc.documentElement);
}

/** whitespace the compiler put there or the author indented with, never a value */
function isBlankText(n: ServerText): boolean {
  return typeof n.textContent === 'string' && n.textContent.trim() === '';
}

/**
 * One text node where there were several, holding one break at most.
 *
 * The first node of the run keeps the whole thing, so nothing has to be
 * constructed and every other node simply goes.
 */
function collapse(run: ServerText[]): void {
  const whole = run.map(n => n.textContent as string).join('');
  const breaks = whole.split('\n');
  if (breaks.length < 3) {
    // one break or none: ordinary indentation, and nothing to close up
    return;
  }
  run[0].textContent = `\n${breaks[breaks.length - 1]}`;
  run.slice(1).forEach(n => n.unlink());
}

/** what a compiled page says built it, when it does not already say */
export const GENERATOR_NAME = 'Markout';

/**
 * The compiler's own version, for the generator meta to carry.
 *
 * Read from the package rather than baked in, the same way the CLI reads it
 * for `--version`: one number, in the file that already holds it, so a
 * release cannot move one and leave the other behind.
 *
 * Absent if it cannot be read -- a bundler that dropped the manifest, or a
 * layout this does not expect. A page that says only `Markout` is a page
 * that says slightly less; one that fails to compile because a version
 * string could not be found would be absurd.
 */
function generatorVersion(): string | undefined {
  if (version === undefined) {
    try {
      const manifest = path.join(__dirname, '../../../package.json');
      version = JSON.parse(fs.readFileSync(manifest, 'utf8')).version as string;
    } catch {
      version = '';
    }
  }
  return version || undefined;
}
let version: string | undefined;

/**
 * `<meta name="generator" content="Markout 0.4.0">`, at the end of `<head>`.
 *
 * How a generator has said what it is since long before this one: a site
 * carries the name of the thing that built it, and everything that counts
 * what the web is made of reads exactly this. It is also the only signal a
 * language gets from the sites it never hears about.
 *
 * **At the end, and this is the reason rather than tidiness.** A document's
 * `<meta charset>` is only honoured within the first 1024 bytes, so anything
 * inserted at the TOP of a head pushes a late-declared one towards that
 * edge. Appending cannot.
 *
 * **With the version.** `Markout 0.4.0` rather than `Markout`, which is what
 * every other generator says and what makes the meta answer a question worth
 * asking: not just what built this page but which release of it, for a bug
 * report, a compatibility check, or a survey of what the web is running.
 *
 * It costs the two things that argued against it, and they are the honest
 * price rather than an oversight: every built page's bytes change on every
 * release, and a reader learns which version to look up advisories for.
 * `generator: false` remains the answer for a deployment that would rather
 * say nothing at all -- which is the reason that switch exists.
 *
 * **Not if the page already says.** An author who wrote their own generator
 * meta has said something deliberate about what made this page, and a
 * second one would contradict it. Matched case-insensitively, because a
 * meta's name is ASCII case-insensitive and `name="Generator"` is the same
 * declaration -- and looked for anywhere in the document rather than only
 * among the head's children. One written in `<body>` is invalid markup and
 * says nothing to a parser, but it is not ambiguous about what its author
 * meant, and answering an odd spelling of "this page was made by X" with a
 * second, contradicting declaration is the worse of the two readings. The
 * walk descends into `<template>` content for the same reason: a region
 * that renders one is still the page saying so.
 *
 * Skipped where there is no `<head>` to append to, which is what a fragment
 * is -- so an imported file carries nothing and the page that imports it
 * carries one.
 */
function injectGenerator(page: Page) {
  const doc = page.source.doc;
  const head = doc.head;
  if (!head || saysGenerator(doc)) {
    return;
  }
  const meta = doc.createElement('meta');
  const said = generatorVersion();
  meta.setAttribute('name', 'generator', head.loc);
  meta.setAttribute('content', said ? `${GENERATOR_NAME} ${said}` : GENERATOR_NAME, head.loc);
  head.appendChild(meta);
}

function saysGenerator(e: ServerElement): boolean {
  const children =
    e.tagName === 'TEMPLATE' ? (e as ServerTemplateElement).content.childNodes : e.childNodes;
  return children.some(n => {
    if (n.nodeType !== NodeType.ELEMENT) return false;
    const el = n as ServerElement;
    return el.tagName === 'META'
      ? `${el.getAttribute('name') ?? ''}`.toLowerCase() === 'generator'
      : saysGenerator(el);
  });
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
    // A group region has no element to be found after its marker, so it
    // needs a second one to say where it stops. Emitted whether or not the
    // region ends up showing: what is between the two IS the region, and
    // an empty pair is how "hidden" looks to the browser
    isGroupStencil(template) &&
      parent.insertBefore(
        new ServerComment(doc, `${DOM_REGION_END_MARKER}${scopeId}`, template.loc),
        template
      );
    parent.removeChild(template);
    head.appendChild(template);
    page.regionStencils.push(template);
  }
}

/** whether what this stencil holds is a `<:group>` rather than an element */
function isGroupStencil(template: ServerTemplateElement): boolean {
  for (const n of template.content.childNodes) {
    if (n.nodeType !== NodeType.ELEMENT) continue;
    return (n as ServerElement).tagName === GROUP_DIRECTIVE_TAG;
  }
  return false;
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
  if (!body || !page.clientProps) {
    return;
  }

  // the scope tree, as data. `type="application/json"` is not script: the
  // browser stores it as text and never hands it to the JavaScript parser,
  // which is the whole reason it is here rather than escaped into the line
  // below
  const dataScript = doc.createElement('script');
  dataScript.setAttribute('type', 'application/json', body.loc);
  dataScript.setAttribute(PROPS_DATA_ATTR, null, body.loc);
  dataScript.appendChild(new ServerText(doc, page.clientProps.data, body.loc, false));
  body.appendChild(dataScript);
  page.bootstrapScripts.push(dataScript);

  const propsScript = doc.createElement('script');
  propsScript.appendChild(
    new ServerText(
      doc,
      `window.${PROPS_GLOBAL} = {e:${escapeScriptClose(page.clientProps.exps)},` +
        `p:JSON.parse(document.querySelector('[${PROPS_DATA_ATTR}]').textContent)};` +
        // tells the browser runtime to surface expression errors in the page
        // the same way SSR just did, instead of only logging them
        (dev ? `window.${DEV_GLOBAL} = true;` : '') +
        // and what lets those errors name a file and a line rather than a
        // scope uid. Dev only, both because a served page must not describe
        // its own sources and because nothing else would ever read it
        (dev && page.clientProps.locs
          ? `window.${LOCS_GLOBAL} = ${escapeScriptClose(page.clientProps.locs)};`
          : ''),
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

/**
 * The props a page carries, as source the runtime can load.
 *
 * Two halves, because they are two different things: an array of the
 * expressions, which have to be JavaScript, and the tree that refers to
 * them by index, which is data and is handed to `JSON.parse`.
 *
 * That split is the whole point. Evaluating the tree as a JavaScript object
 * literal made the parser walk every scope, every key and every dependency
 * path; `JSON.parse` has a dedicated one and does the same work about five
 * times faster (4.8ms to 1.0ms on this repository's biggest page). The
 * expressions still go through the JavaScript parser, but V8 only
 * pre-scans a function body and compiles it when it is first called, so
 * that half costs almost nothing -- 0.03ms of the 1.0.
 *
 * The JSON is never made into JavaScript, which is the point of keeping it
 * separate: it travels as the text of a `<script type="application/json">`,
 * where a quote is a quote. Escaping it into a string literal cost a byte
 * for every one of them, and there are two per key.
 *
 * `<` is escaped to `\u003c` -- a valid JSON escape, and the only thing that
 * could end that element early, since `</script` and `<!--` both need one.
 */
function emitProps(root: Scope, forClient: boolean, dev: boolean): CompiledProps {
  const exps = new Expressions();
  // dev only, and the whole reason it is a separate artifact rather than a
  // field on each value: a served page must not describe its own sources,
  // and a page that is not being developed should not pay a byte for a map
  // nobody will read. See Locations
  const locs = dev ? new Locations() : undefined;
  const data = generateScope(root, forClient, exps, dev, locs);
  const gap = dev ? '\n' : '';
  return {
    exps: `[${gap}${exps.texts.join(`,${gap}`)}${gap}]`,
    data: JSON.stringify(data, null, dev ? 1 : undefined).replace(/</g, '\\u003c'),
    locs: locs?.json(),
  };
}

/**
 * Where each value was written, by the name the RUNTIME knows it by.
 *
 * A runtime failure names a scope uid and a value key -- `s12.total` -- which
 * are the compiler's own and nothing an author typed. Compile-time errors
 * name a file and a line, and "mistakes caught with a file and a line" is the
 * row this project is sold on, so it holding only until the page starts
 * running is the pitch expiring at the moment it matters most.
 *
 * Keyed `scopeId.key` and flat, because that is exactly the lookup
 * `CoreContext.onError` has to do and one string beats walking a tree per
 * failure. The value is spelled the way `formatPageError` spells one, so a
 * compile error and a runtime error name a place the same way.
 */
class Locations {
  private readonly map: { [key: string]: string } = {};
  private empty = true;

  add(scopeId: string, key: string, value: Value): void {
    const loc = value.node.loc;
    if (!loc) {
      return;
    }
    // `source` names the file the value was written in, which is not the page
    // when it came from an imported fragment -- the case where naming the
    // file earns the most
    const where = (loc as { source?: string }).source;
    this.map[`${scopeId}.${key}`] =
      `${where ?? ''}:${loc.start.line}:${loc.start.column + 1}`;
    this.empty = false;
  }

  /** absent rather than `{}` when nothing had a location worth carrying */
  json(): string | undefined {
    return this.empty ? undefined : JSON.stringify(this.map).replace(/</g, '\\u003c');
  }
}

/**
 * What a compiled scope is, once its expressions have been lifted out.
 *
 * Plain data -- the same shape `CoreScopeProps` describes, with `exp` an
 * index into the page's expression table rather than a function, so the
 * whole tree can be serialized as JSON.
 */
interface ScopeData {
  id: string;
  name?: string;
  /** a `<:group>` region: markup with no element of its own, held between
   * a marker at each end rather than by the element carrying the `:if` */
  group?: true;
  /** a `<:logic>`, or an instance of a `tag="x:logic"`: a scope with no
   * element of ITS OWN, which is what gives it a lifetime rather than a view */
  elementless?: true;
  slotted?: true;
  slottedText?: true;
  elseOf?: string;
  elseNext?: string;
  template?: string;
  attributes?: { [name: string]: string };
  values?: { [key: string]: ValueData };
  /** what a custom-tag usage site DECLARED rather than passed -- built on the
   * instance's usage-site scope, see CoreScopeProps.usageValues */
  usageValues?: { [key: string]: ValueData };
  children?: ScopeData[];
}

interface ValueData {
  exp?: number;
  deps?: string[][];
  maybeDeps?: string[][];
  callSite?: true;
  serverOnly?: true;
}

/**
 * The page's expressions, each once.
 *
 * Props are data with holes in them: everything the runtime needs is JSON
 * except the expressions, which have to be JavaScript. So they are lifted
 * out into one array and referred to by index, which is what lets the rest
 * be handed to `JSON.parse` -- five times faster than evaluating the same
 * tree as a JavaScript object literal, because the structure never reaches
 * the JavaScript parser at all.
 *
 * Deduplicated by source text, which is the larger half of what this buys.
 * A component's expressions are re-emitted for every instance of it, so a
 * page's arrows are mostly repeats: 2,162 of them on this repository's
 * biggest page are 451 distinct ones. Safe because an expression captures
 * nothing but its own `$` parameter -- two with the same text are the same
 * function, and that became readable off the shape the morning `$` replaced
 * `this`.
 */
class Expressions {
  readonly texts: string[] = [];
  private readonly seen = new Map<string, number>();

  add(text: string): number {
    const found = this.seen.get(text);
    if (found !== undefined) {
      return found;
    }
    const index = this.texts.length;
    this.texts.push(text);
    this.seen.set(text, index);
    return index;
  }
}

function generateScope(
  scope: Scope,
  forClient: boolean,
  exps: Expressions,
  dev: boolean,
  locs?: Locations
): ScopeData {
  const values: { [key: string]: ValueData } = {};
  for (const [name, value] of [...scope.values, ...scope.textValues]) {
    const key = toRuntimeKey(name);
    values[key] = generateValueProps(
      value,
      scope.callSiteValues?.has(name),
      forClient,
      exps,
      dev
    );
    locs?.add(scope.id, key, value);
  }

  const props: ScopeData = { id: scope.id };
  if (scope.usageValues?.size) {
    // what the usage site DECLARED, kept apart from what it passed: the
    // runtime builds these on the instance's usage-site scope, so they are
    // reachable from the caller's markup and from nowhere in the definition
    const usageValues: { [key: string]: ValueData } = {};
    for (const [name, value] of scope.usageValues) {
      // no `callSite`: these are built ON that scope rather than held by the
      // instance on its behalf, so the scope they evaluate against is simply
      // their own
      const key = toRuntimeKey(name);
      usageValues[key] = generateValueProps(value, false, forClient, exps, dev);
      locs?.add(scope.id, key, value);
    }
    props.usageValues = usageValues;
  }
  if (scope.name) {
    props.name = scope.name;
  }
  if (scope.e?.tagName === GROUP_DIRECTIVE_TAG) {
    // the tag is not markup and never reaches a browser; what the runtime
    // shows and hides is the run of nodes between this region's two markers
    props.group = true;
  }
  if (
    scope.page.logicScopes.has(scope) ||
    (scope.usesTag && scope.page.elementlessTags.has(scope.usesTag))
  ) {
    // said here rather than inferred from there being no DOM: the runtime
    // needs the answer while LINKING, before `init` has looked for an
    // element, and "no element yet" and "no element ever" are not the same
    props.elementless = true;
  }
  if (scope.slotted) {
    // written at a usage site, living inside the instance: the runtime
    // resolves its names from outside rather than from the definition
    props.slotted = true;
  }
  if (scope.slottedText) {
    // holds text written at a usage site: that text resolves out at the
    // instance's call site, while everything else here resolves against the
    // definition (see CoreScope.hostFor)
    props.slottedText = true;
  }
  if (scope.elseOf) {
    // an `:else`/`:else-if`: which branch it continues, and which continues
    // it. Emitted only for a chain, so a lone `:if` carries neither and the
    // runtime's fast path stays the only path it takes
    props.elseOf = scope.elseOf.id;
  }
  if (scope.elseNext) {
    props.elseNext = scope.elseNext.id;
  }
  if (scope.usesTemplate) {
    // a custom-tag usage instance: WebScope instantiates its DOM from the
    // named <:define> stencil if no already-rendered element is found
    props.template = scope.usesTemplate;
  }
  if (scope.attributes?.size) {
    props.attributes = Object.fromEntries(
      [...scope.attributes].map(([name, value]) => [name, value ?? ''])
    );
  }
  props.values = values;
  // a <:define> scope is never itself live at its own (natural, nested)
  // position -- only usage-site instances of it are, elsewhere in the tree
  props.children = scope.children
    .filter(child => !scope.page.definitionScopes.has(child))
    .map(c => generateScope(c, forClient, exps, dev, locs));

  return props;
}

function generateValueProps(
  value: Value,
  callSite: boolean | undefined,
  forClient: boolean | undefined,
  exps: Expressions,
  dev: boolean
): ValueData {
  if (forClient && value.serverOnly) {
    // the mark and nothing else: the client reads its result out of the
    // page's state, and has neither the expression nor the dependency edges
    // that would let it try to produce one of its own. Absent a result the
    // value is simply `undefined` -- see stage7generate for why that is the
    // wanted outcome rather than a lost fallback
    return { serverOnly: true };
  }
  const arrow = functionExpression(generateExpBody(value));
  unwrapRegexLiterals(arrow);
  const props: ValueData = {
    exp: exps.add(generate(arrow, codegenOptions(dev))),
    // split, because the two halves make different promises to the runtime:
    // an ordinary dependency must resolve, and one that walks into a region
    // is allowed not to while that region is away. See CoreValueProps.maybeDeps
    deps: value.deps.filter(d => !d.maybe).map(makeDep),
  };
  const maybes = value.deps.filter(d => d.maybe);
  if (maybes.length) {
    props.maybeDeps = maybes.map(makeDep);
  }
  // written at a custom-tag usage site: evaluated against the scope the tag
  // was written in, not against the instance (see CoreScope.newValue)
  callSite && (props.callSite = true);
  // `:server-`: the server collects this value after rendering and sends the
  // result, which the client uses instead of running `exp` (see CoreContext)
  value.serverOnly && (props.serverOnly = true);
  return props;
}

function generateExpBody(value: Value): Expression {
  const expression = value.value;
  if (expression == null) {
    // a presence-only attribute (e.g. bare `:class-active`) implies `true`
    return literal(true);
  }
  if (typeof expression === 'string') {
    // `class+="mb-0 shadow"` and the other three: a literal is read the way
    // HTML spells that attribute, and folded HERE into the same typed value
    // an expression would have carried -- so nothing downstream, the runtime
    // included, ever meets the string form
    if (SET_OPERATOR_ATTRS.has(value.name)) {
      return value.name === SET_OPERATOR_MAP_ATTR
        ? objectExpression(parseDeclarations(expression))
        : arrayExpression(tokens(expression));
    }
    // a plain (non-`${}`) value is a static literal, not an expression
    return literal(expression);
  }
  return expression as unknown as Expression;
}

/** a space-separated attribute value, as the names it holds */
function tokens(s: string): string[] {
  return s.split(/\s+/).filter(t => t.length > 0);
}

/**
 * A dependency, emitted as the path to it: `["$parent", "total"]`.
 *
 * Data rather than the closure this used to be. Every edge was a
 * `function () { return this.$value('total'); }` -- thirty-five characters
 * to say what nine say, allocated at mount and called once -- and on a page
 * of any size they were the largest single thing the props carried. The
 * runtime walks the path instead (CoreValue.resolveDep); `ValueDepRef`
 * already WAS this pair, and stage7 used to turn it back into a function.
 *
 * Every segment but the last is a property of the scope proxy -- `$parent`,
 * `$host`, or a named scope's `:aka` -- and the last is the key. The two
 * flavours the runtime tells apart by which array they arrive in, exactly
 * as before: a `deps` entry must resolve, a `maybeDeps` one is allowed not
 * to while the region it reaches into is away. `$host` keeps its fallback,
 * which moved to the runtime with the walk.
 */
function makeDep(dep: ValueDepRef): string[] {
  return [...(dep.via ?? []), dep.key];
}

function toRuntimeKey(name: string): string {
  const prefix = RUNTIME_KEY_PREFIX_MAP.find(([from]) => name.startsWith(from));
  return prefix ? prefix[1] + name.slice(prefix[0].length) : name;
}

// ===========================================================================
// small AST builders
// ===========================================================================

// scope value names (class$/style$/on$ suffixes, in particular) may contain
// dashes -- not valid bare identifiers -- so always quote them; escodegen
// prints an Identifier key as-is without validation, which would otherwise
// emit syntactically broken source (e.g. `on$item-selected: ...`)
function identifier(name: string): Expression {
  return { type: 'Identifier', name } as unknown as Expression;
}

function literal(value: string | number | boolean): Expression {
  return { type: 'Literal', value } as unknown as Expression;
}

function arrayExpression(values: string[]): Expression {
  return {
    type: 'ArrayExpression',
    elements: values.map(v => literal(v)),
  } as unknown as Expression;
}

function objectExpression(entries: [string, string][]): Expression {
  return {
    type: 'ObjectExpression',
    properties: entries.map(([k, v]) => ({
      type: 'Property',
      kind: 'init',
      method: false,
      shorthand: false,
      // quoted, like every other key here: a CSS property is dashed, and a
      // dashed Identifier prints as broken source
      computed: false,
      key: literal(k),
      value: literal(v),
    })),
  } as unknown as Expression;
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

/**
 * `$ => <expression>`: the wrapper the runtime calls to evaluate a value.
 *
 * An arrow taking the scope as an argument, where this used to be a plain
 * `function` called with `.apply(scope.proxy)`. That calling convention was
 * the whole reason a classic `function` could not appear anywhere inside an
 * expression -- it would have rebound `this` and lost the scope -- so the
 * language carried a refusal for the sake of a wrapper. A parameter is
 * captured like any other closure variable, and the refusal went with it.
 *
 * Cheaper as well as freer, which is what the entry in TODO.md was after:
 * `function(){return x}` is twenty characters of wrapper against four, and
 * every reference inside it says `$.` where it used to say `this.`.
 */
function functionExpression(returned: Expression): Expression {
  return {
    type: 'ArrowFunctionExpression',
    id: null,
    params: [identifier(RT_SCOPE_PARAM)],
    generator: false,
    async: false,
    expression: true,
    body: returned,
  } as unknown as Expression;
}

