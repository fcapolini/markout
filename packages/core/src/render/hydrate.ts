import type { Document } from '../html/dom';
import type { Page } from '../compiler/ir/Page';
import type { ServerText } from '../html/server-dom';
import type { PageState, RuntimeError } from '../runtime/core/core-context';
import { STATE_GLOBAL } from '../runtime/core/core-context';
import { WebContext } from '../runtime/web/web-context';
import { loadProps } from './props';

/**
 * What a mounted page hands back.
 *
 * Deliberately small: a page's values and the errors it produced are the two
 * things a test has to reach, and everything else it wants to assert is in
 * the document it supplied.
 */
export interface Hydrated {
  /**
   * The root scope's values, by name, readable and writable.
   *
   * Nested scopes are properties on it, so `<body>`'s values are
   * `root.body.count` and a scope with `:aka="cart"` is `root.cart`. Writing
   * one propagates exactly as it does in a browser -- synchronously, and
   * through everything reading it -- so the assertion after the write is
   * about a settled page.
   */
  root: { [name: string]: any };
  /**
   * Every runtime failure, in order, and it keeps filling.
   *
   * The array is the one the context reports into rather than a copy taken
   * at mount, so a failure caused by a later write shows up here too. A test
   * that asserts it is empty at the end is asserting about the whole
   * interaction rather than about hydration.
   */
  errors: RuntimeError[];
}

/**
 * Runs a compiled page against a real DOM: the mounting half of what a
 * browser does when it loads a served page.
 *
 * This exists for **testing**, which is the one caller that has a document
 * of its own and no server. A browser gets here through the runtime bundle,
 * and `renderPage` gets here with the compiler's own `ServerDocument`; both
 * of those own the whole arrangement, and neither can be borrowed to answer
 * "does my component do the right thing when someone clicks it".
 *
 * The document is supplied rather than made, which is the whole reason this
 * can live in core: happy-dom and jsdom are a test's dependency and must not
 * become the compiler's. Anything implementing enough of the DOM works, and
 * what "enough" means is set by the runtime rather than here.
 *
 * **No `globals` option, deliberately.** `renderPage` takes one because the
 * host supplies those to the SERVER, and a name so supplied may only be read
 * from a `:server-` value -- by the time a page is mounted its result has
 * already been carried over as state. The browser runtime supplies none, so
 * accepting them here would let a test drive a page in a way no browser can,
 * and pass. Fake a host handle at `renderPage`, where the page reads it.
 *
 * See `docs/reference/testing.md` for the recipe this is the last step of.
 */
export function hydrate(
  page: Page,
  props: {
    /** where to mount: a happy-dom or jsdom document, or a browser's own */
    doc: Document;
    /**
     * The page's own origin, which a browser takes from `location.origin`.
     *
     * Supplied here because a test document's location is its runner's
     * rather than the page's, and `$origin` reading the wrong one is worse
     * than it reading nothing.
     */
    origin?: string;
    /**
     * The whole address, as `$url`, for the same reason: a test document's
     * `location.href` is the runner's. `$origin` is taken from it when no
     * origin is passed.
     */
    url?: string;
    /** paint failures into the page as the dev server does, as well as reporting them */
    dev?: boolean;
  }
): Hydrated {
  const errors: RuntimeError[] = [];
  if (!page.props) {
    // Not the static-page case: a page with no expressions still compiles to
    // props, because the scope tree is there either way. Getting here means
    // the page did not compile at all, and answering with an empty root
    // would be a test that mounts nothing, asserts nothing, and passes.
    const first = page.errors.find(e => e.type === 'error');
    throw new Error(
      first
        ? `cannot mount a page that did not compile: ${first.msg}`
        : 'cannot mount a page that produced no props'
    );
  }
  const ctx = new WebContext({
    ...loadProps(page.props),
    doc: props.doc,
    dev: props.dev,
    origin: props.origin,
    url: props.url,
    state: stateOf(page),
    onError: e => errors.push(e),
  }).refresh();
  return { root: ctx.root.proxy as { [name: string]: any }, errors };
}

/**
 * The `:server-` results the render produced, read back the way the browser
 * gets them.
 *
 * A served page carries them in a `<script>`, and the browser has them
 * because it ran it. A test document does not: happy-dom and jsdom do not
 * execute what `document.write` puts in them, so without this the page would
 * mount with no state and every `:server-` value would fall back to
 * re-evaluating an expression the browser never re-evaluates -- reporting
 * failures no browser would ever see, on a page that works.
 *
 * So the script is run here instead, into an object standing in for `window`.
 * It is the compiler's own output rather than anything a page author wrote,
 * and `loadProps` already evaluates the props beside it for the same reason:
 * this is generated code being loaded, not input being trusted.
 */
function stateOf(page: Page): PageState | undefined {
  // the script holds one text child, written by emitState; a ServerText's
  // `textContent` is a string or an expression node, and only the first is
  // anything to run
  const child = page.stateScript?.childNodes[0] as ServerText | undefined;
  const text = child?.textContent;
  if (typeof text !== 'string' || !text.trim()) {
    return undefined;
  }
  const window: Record<string, unknown> = {};
  new Function('window', text)(window);
  return window[STATE_GLOBAL] as PageState | undefined;
}
