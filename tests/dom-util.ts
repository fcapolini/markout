import { generate } from 'escodegen';
import { Window } from 'happy-dom';
import { Compiler, CompilerPage } from '../src/compiler/compiler';
import * as dom from '../src/html/dom';
import { parse } from '../src/html/parser';
import { BaseContext } from '../src/runtime/base/base-context';
import { BaseGlobal } from '../src/runtime/base/base-global';
import { WebContext } from '../src/runtime/web/web-context';

/**
 * Run a page with Happy DOM for DOM testing
 * This function is separate from util.ts to avoid loading Happy DOM unless needed
 */
export async function runPage(
  client: boolean,
  html: string
): Promise<WebContext> {
  const page: CompilerPage = { source: parse(html, 'test') };
  const global = new BaseGlobal(new BaseContext({ root: { id: '-' } }));
  Compiler.compilePage(page, global);
  if (page.source.errors.length) {
    throw new Error('error: ' + page.source.errors[0].msg);
  }
  const code = eval(generate(page.code));
  const ctx = new WebContext({
    doc: page.source.doc,
    root: code,
  }).refresh();
  if (!client) {
    return ctx;
  }

  const window = new Window();
  window.document.documentElement.innerHTML = page.source.doc.toString();
  const clientCtx = new WebContext({
    doc: window.document as unknown as dom.Document,
    root: code,
  }).refresh();

  return clientCtx;
}

/**
 * Create a document from HTML using Happy DOM
 */
export function createDocument(html: string): dom.Document {
  const window = new Window();
  window.document.documentElement.innerHTML = html;
  return window.document as unknown as dom.Document;
}
