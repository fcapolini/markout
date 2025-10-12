import { JSDOM } from 'jsdom';
import { generate } from 'escodegen';
import { Compiler, CompilerPage } from '../src/compiler/compiler';
import { WebContext } from '../src/runtime/web/web-context';
import { parse } from '../src/html/parser';
import * as dom from '../src/html/dom';

/**
 * Run a page with JSDOM for DOM testing
 * This function is separate from util.ts to avoid loading JSDOM unless needed
 */
export async function runPage(
  client: boolean,
  html: string
): Promise<WebContext> {
  const page: CompilerPage = { source: parse(html, 'test') };
  Compiler.compilePage(page);
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

  const jsdom = new JSDOM(page.source.doc.toString());
  const clientCtx = new WebContext({
    doc: jsdom.window.document as unknown as dom.Document,
    root: code,
  }).refresh();

  return clientCtx;
}

/**
 * Create a document from HTML using JSDOM
 */
export function createDocument(html: string): dom.Document {
  const jsdom = new JSDOM(html);
  return jsdom.window.document as unknown as dom.Document;
}
