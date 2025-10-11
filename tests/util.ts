import * as acorn from 'acorn';
import estraverse from 'estraverse';
import { Compiler, CompilerPage, CompilerScope, CompilerValue } from '../src/compiler/compiler';
import { WebScope } from '../src/runtime/web/web-scope';
import { normalizeText, parse } from '../src/html/parser';
import { generate } from 'escodegen';
import { WebContext } from '../src/runtime/web/web-context';
import * as dom from '../src/html/dom';
import { JSDOM } from 'jsdom';
import { ServerDocument } from '../src/html/server-dom';

export function cleanupScopes(scope: CompilerScope) {
  const cleanupExpression = (exp: acorn.Node) => {
    return estraverse.replace(exp as any, {
      enter: (node) => {
        delete (node as any).start;
        delete (node as any).end;
        delete (node as any).loc;
      }
    });
  }
  const cleanupValue = (value: CompilerValue) => {
    delete (value as any).keyLoc;
    delete (value as any).valLoc;
    if (typeof value.val === 'object') {
      value.val = cleanupExpression(value.val as acorn.Node) as any;
    }
  }
  scope.name && cleanupValue(scope.name);
  scope.values && Object.keys(scope.values).forEach((v) =>
    cleanupValue(scope.values![v])
  );
  delete (scope as any).parent;
  delete (scope as any).loc;
  scope.children.forEach(s => cleanupScopes(s));
  return scope;
};

export function dumpScopes(scope: WebScope, tab = '') {
  console.log(`${tab}${scope.props.id} ${scope.dom?.tagName}`);
  scope.children.forEach(child => dumpScopes(child as WebScope, tab + '\t'));
}

export async function runPage(client: boolean, html: string): Promise<WebContext> {
  const page: CompilerPage = { source: parse(html, 'test') };
  Compiler.compilePage(page);
  if (page.source.errors.length) {
    throw 'error: ' + page.source.errors[0].msg;
  }
  const code = eval(generate(page.code));
  const ctx = new WebContext({
    doc: page.source.doc,
    root: code,
  });
  if (!client) {
    return ctx;
  }

  const jsdom = new JSDOM(page.source.doc.toString());
  const clientCtx = new WebContext({
    doc: jsdom.window.document as unknown as dom.Document,
    root: code,
  });

  return clientCtx;
}

export function getMarkup(doc: any, cleanup = true): string {
  let act = doc instanceof ServerDocument ? doc.toString() : doc.documentElement.outerHTML;
  if (cleanup) {
    act = act.replace(/ data-domaze="\d+"/g, '');
    act = act.replace(/<!---.*?-->/g, '');
    act = normalizeText(act)!;
  }
  return act;
}

export function getDoc(html: string, client = false) {
  if (client) {
    const jsdom = new JSDOM(html);
    return jsdom.window.document as unknown as dom.Document;
  }
  const source = parse(html, 'test');
  return source.doc;
}
