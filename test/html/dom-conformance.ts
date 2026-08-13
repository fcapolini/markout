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
declare const browserText: Text;
declare const browserComment: Comment;
declare const browserDocument: Document;
declare const browserFragment: DocumentFragment;
declare const browserTemplate: HTMLTemplateElement;

export const asElement: dom.Element = browserElement;
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
