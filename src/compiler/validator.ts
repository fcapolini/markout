import estraverse from 'estraverse';
import * as es from 'estree';
import { PageError, Source } from '../html/parser';
import { CompilerScope, CompilerValue } from './compiler';
import { EVENT_ATTR_PREFIX } from './const';

export function validate(source: Source, root: CompilerScope): boolean {
  validateScope(source, root);
  return source.errors.length === 0;
}

function validateScope(source: Source, scope: CompilerScope) {
  scope.values &&
    Object.keys(scope.values).forEach(key => {
      const value = scope.values![key];
      if (key.startsWith(EVENT_ATTR_PREFIX)) {
        if (
          typeof value.val !== 'object' ||
          value.val?.type !== 'ArrowFunctionExpression'
        ) {
          addError(source, value, 'event handler must be an arrow function');
          return;
        }
      }
      validateValue(source, value);
    });

  // Note: Both class/style attributes and :class-/:style- attributes can now be used
  // together safely. The ServerElement implementation merges them properly in
  // getAttribute() by combining both the attribute value and classList/style values.

  scope.children.forEach(child => validateScope(source, child));
}

function validateValue(source: Source, value: CompilerValue) {
  if (typeof value.val !== 'object') {
    return;
  }
  estraverse.traverse(value.val as es.Node, {
    enter: (node, parent) => {
      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression'
      ) {
        addError(source, value, 'only arrow functions allowed', node.loc!);
      }

      // Check for dollar sign in declarations only, not access
      if (node.type === 'Identifier' && node.name.includes('$')) {
        const isDeclaration =
          // Variable declarations: const x$, let x$, var x$
          (parent?.type === 'VariableDeclarator' && parent.id === node) ||
          // Function parameters: function(x$) or (x$) =>
          (parent?.type === 'FunctionDeclaration' &&
            parent.params.includes(node)) ||
          (parent?.type === 'ArrowFunctionExpression' &&
            parent.params.includes(node)) ||
          (parent?.type === 'FunctionExpression' &&
            parent.params.includes(node)) ||
          // Function names: function x$()
          (parent?.type === 'FunctionDeclaration' && parent.id === node) ||
          (parent?.type === 'FunctionExpression' && parent.id === node) ||
          // Property definitions in object literals: {x$: ...}
          (parent?.type === 'Property' &&
            parent.key === node &&
            !parent.computed) ||
          // Assignment patterns in destructuring: {x$} = obj
          (parent?.type === 'AssignmentPattern' && parent.left === node);

        if (isDeclaration) {
          addError(
            source,
            value,
            'dollar sign ($) is reserved for framework use and cannot be used in user-declared identifiers',
            node.loc!
          );
        }
      }
    },
  });
}

function addError(
  source: Source,
  value: CompilerValue,
  msg: string,
  loc?: es.SourceLocation
) {
  loc || (loc = value.valLoc ?? value.keyLoc);
  source.errors.push(new PageError('error', msg, loc));
}
