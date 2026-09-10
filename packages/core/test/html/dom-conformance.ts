/**
 * Compile-time only: asserts that real browser DOM objects satisfy the
 * interfaces in `src/html/dom.ts`, which is what lets server-side rendering
 * substitute this DOM for the browser's one.
 *
 * This file is never executed and is not part of the normal typecheck — it
 * needs `lib.dom`, which the package deliberately excludes. It is compiled by
 * `npm run typecheck:dom` (see tsconfig.dom.json), so a change to the shared
 * interfaces that quietly breaks the substitution fails the build.
 */
import * as dom from '../../src/html/dom';

declare const browserElement: HTMLElement;
declare const browserSvgElement: SVGElement;
declare const browserText: Text;
declare const browserComment: Comment;
declare const browserDocument: Document;
declare const browserFragment: DocumentFragment;
declare const browserTemplate: HTMLTemplateElement;

export const asElement: dom.Element = browserElement;
/**
 * An SVG element is an Element too, and the runtime treats it as one: an
 * icon component is a `<:define>` whose root element is an `<svg>`.
 *
 * Asserted separately because it is not an `HTMLElement`. It does not catch
 * the divergence that this suite exists to think about, and cannot: at
 * RUNTIME an SVG element's `className` is an `SVGAnimatedString` rather than
 * a string -- which is how the class machinery came to call `.split` on an
 * object -- while `lib.dom` types it as the string it inherits from
 * `Element`. What keeps the two sides substitutable is that `dom.Element` no
 * longer names `className` at all, so nothing isomorphic can reach for it;
 * `getAttribute('class')` is the spelling that means the same thing on both
 * kinds of element, and on a `ServerElement`.
 */
export const asSvgElement: dom.Element = browserSvgElement;
export const asText: dom.Text = browserText;
export const asComment: dom.Comment = browserComment;
export const asDocument: dom.Document = browserDocument;
export const asFragment: dom.DocumentFragment = browserFragment;
export const asTemplate: dom.TemplateElement = browserTemplate;

// the property bags the runtime touches on both sides
export const asClassProp: dom.ClassProp = browserElement.classList;
export const asStyleProp: dom.StyleProp = browserElement.style;

// a server document is of course expected to satisfy them too
import { ServerDocument, ServerElement } from '../../src/html/server-dom';
declare const serverDocument: ServerDocument;
declare const serverElement: ServerElement;
export const serverAsDocument: dom.Document = serverDocument;
export const serverAsElement: dom.Element = serverElement;
