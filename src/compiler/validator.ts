import estraverse from 'estraverse';
import * as es from 'estree';
import { PageError, Source } from "../html/parser";
import { CompilerScope, CompilerValue } from "./compiler";
import { CLASS_ATTR_PREFIX, EVENT_ATTR_PREFIX, STYLE_ATTR_PREFIX } from './const';

export function validate(source: Source, root: CompilerScope): boolean {
  validateScope(source, root);
  return (source.errors.length === 0);
}

function validateScope(source: Source, scope: CompilerScope) {
  let hasClassAttr = false;
  let hasStyleAttr = false;

  scope.values && Object.keys(scope.values).forEach(key => {
    hasClassAttr ||= (key.startsWith(CLASS_ATTR_PREFIX));
    hasStyleAttr ||= (key.startsWith(STYLE_ATTR_PREFIX));
    const value = scope.values![key];
    if (key.startsWith(EVENT_ATTR_PREFIX)) {
      if (
        typeof value.val !== 'object' ||
        value.val?.type !== 'ArrowFunctionExpression'
      ) {
        addError(source, value, 'event handler must be an arrow function');
        return
      }
    }
    validateValue(source, value);
  });

  if (hasClassAttr && scope.values!['attr_class']) {
    const attr = scope.values!['attr_class'];
    addError(
      source,
      attr,
      'dynamic "class" attribute and "class_" attributes cannot be used'
      + ' at the same time',
      attr.valLoc || attr.keyLoc
    );
  }

  if (hasStyleAttr && scope.values!['attr_style']) {
    const attr = scope.values!['attr_style'];
    addError(
      source,
      attr,
      'dynamic "style" attribute and "style_" attributes cannot be used'
      + ' at the same time',
      attr.valLoc || attr.keyLoc
    );
  }

  scope.children.forEach(child => validateScope(source, child));
}

function validateValue(source: Source, value: CompilerValue) {
  if (typeof value.val !== 'object') {
    return;
  }
  estraverse.traverse(value.val as es.Node, {
    enter: (node) => {
      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression'
      ) {
        addError(source, value, 'only arrow functions allowed', node.loc!);
      }
    }
  });
}

function addError(
  source: Source,
  value: CompilerValue,
  msg: string,
  loc?: es.SourceLocation
) {
  loc || (loc = value.valLoc ?? value.keyLoc);
  source.errors.push(new PageError("error", msg, loc));
}
