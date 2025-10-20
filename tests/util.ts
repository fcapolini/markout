import * as acorn from 'acorn';
import estraverse from 'estraverse';
import { CompilerScope, CompilerValue } from '../src/compiler/compiler';
import { normalizeText, parse } from '../src/html/parser';
import { ServerDocument } from '../src/html/server-dom';
import { WebScope } from '../src/runtime/web/web-scope';

/**
 * Normalizes line endings to LF (\n) for cross-platform compatibility
 */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Normalizes text for comparison by handling both whitespace and line endings
 */
export function normalizeTextForComparison(text: string): string {
  return normalizeText(normalizeLineEndings(text)) || '';
}

export function cleanupScopes(scope: CompilerScope) {
  const cleanupExpression = (exp: acorn.Node) => {
    return estraverse.replace(exp as any, {
      enter: node => {
        delete (node as any).start;
        delete (node as any).end;
        delete (node as any).loc;
      },
    });
  };
  const cleanupValue = (value: CompilerValue) => {
    delete (value as any).keyLoc;
    delete (value as any).valLoc;
    if (typeof value.val === 'object') {
      value.val = cleanupExpression(value.val as acorn.Node) as any;
    }
  };
  scope.name && cleanupValue(scope.name);
  scope.values &&
    Object.keys(scope.values).forEach(v => cleanupValue(scope.values![v]));
  delete (scope as any).parent;
  delete (scope as any).loc;
  scope.children.forEach(s => cleanupScopes(s));
  return scope;
}

export function dumpScopes(scope: WebScope, tab = '') {
  console.log(`${tab}${scope.props.id} ${scope.dom?.tagName}`);
  scope.children.forEach(child => dumpScopes(child as WebScope, tab + '\t'));
}

// Note: runPage function moved to dom-util.ts to avoid loading Happy DOM unless needed

export function getMarkup(doc: any, cleanup = true): string {
  let act =
    doc instanceof ServerDocument
      ? doc.toString()
      : doc.documentElement.outerHTML;
  if (cleanup) {
    act = act.replace(/ data-markout="\d+"/g, '');
    act = act.replace(/<!---.*?-->/g, '');
    act = normalizeText(act)!;
  }
  return act;
}

export function getDoc(html: string, client = false) {
  if (client) {
    // DOM functionality moved to dom-util.ts to keep DOM dependencies separate
    throw new Error('Client-side getDoc moved to dom-util.ts');
  }
  const source = parse(html, 'test');
  return source.doc;
}
