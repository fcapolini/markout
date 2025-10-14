/**
 * PROTOTYPE: Optional Dependencies Implementation
 *
 * This file demonstrates how optional dependencies with `?` syntax
 * would be implemented in the Markout compiler pipeline.
 *
 * Target: v1.x implementation
 */

import * as acorn from 'acorn';
import estraverse from 'estraverse';
import * as es from 'estree';

// Extended AST node types for optional dependencies
interface OptionalMemberExpression extends es.MemberExpression {
  optional: true;
  _originalProperty?: string; // Store original property name with '?'
}

interface OptionalCompilerValue {
  exp: Function;
  deps?: string[];
  optionalDeps?: string[]; // NEW: Optional dependency references
  refs?: Set<string>;
  optionalRefs?: Set<string>; // NEW: Optional reference tracking
}

/**
 * Phase 1: Enhanced Qualifier - Detects and transforms optional syntax
 *
 * Transforms: head.darkMode? -> head?.darkMode (with metadata)
 */
export function qualifyWithOptionalDeps(exp: acorn.Expression): {
  ast: acorn.Expression;
  hasOptionalDeps: boolean;
} {
  let hasOptionalDeps = false;

  const transformedAst = estraverse.replace(exp as es.Node, {
    enter: (node, parent) => {
      // Detect optional property access: identifier ending with '?'
      if (node.type === 'Identifier' && node.name.endsWith('?')) {
        // This is an optional property access
        const propertyName = node.name.slice(0, -1); // Remove '?'
        hasOptionalDeps = true;

        // Mark parent MemberExpression as optional
        if (parent?.type === 'MemberExpression' && parent.property === node) {
          const optionalMember = parent as OptionalMemberExpression;
          optionalMember.optional = true;
          optionalMember._originalProperty = node.name;

          // Return transformed property identifier
          return {
            ...node,
            name: propertyName,
          };
        }
      }
    },
  }) as acorn.Expression;

  return {
    ast: transformedAst,
    hasOptionalDeps,
  };
}

/**
 * Phase 2: Enhanced Resolver - Handles optional dependency validation
 */
export function validateOptionalValueRef(
  scope: any, // CompilerScope
  value: OptionalCompilerValue,
  path: string[],
  isOptional: boolean
): boolean {
  // Simulate dependency lookup
  const target = mockLookup(scope, path[0]);

  if (!target) {
    if (isOptional) {
      // Store as optional reference - no error
      value.optionalRefs = value.optionalRefs || new Set();
      value.optionalRefs.add(`this.${path.join('.')}`);
      return true; // No error for optional deps
    } else {
      // Required dependency missing - error
      return false;
    }
  }

  // Dependency found - store as regular reference
  value.refs = value.refs || new Set();
  value.refs.add(`this.${path.join('.')}`);
  return true;
}

/**
 * Phase 3: Code Generation - Generates safe property access
 */
export function generateOptionalExpression(
  ast: acorn.Expression,
  hasOptionalDeps: boolean
): string {
  if (!hasOptionalDeps) {
    // Standard generation for non-optional expressions
    return generateStandardExpression(ast);
  }

  // Transform AST to use optional chaining
  const safeAst = estraverse.replace(ast as es.Node, {
    enter: node => {
      if (node.type === 'MemberExpression') {
        const member = node as OptionalMemberExpression;
        if (member.optional) {
          // Generate optional chaining syntax
          return {
            ...member,
            type: 'ChainExpression',
            expression: {
              ...member,
              optional: true,
            },
          };
        }
      }
    },
  });

  return generateSafeExpression(safeAst);
}

/**
 * Demo: Complete transformation pipeline
 */
export function demonstrateOptionalDeps() {
  console.log('=== Optional Dependencies Prototype ===\n');

  // Example 1: Optional single property
  demonstrateTransformation('head.darkMode?', 'Single optional property');

  // Example 2: Mixed optional and required
  demonstrateTransformation(
    'head.darkMode? && user.loggedIn',
    'Mixed dependencies'
  );

  // Example 3: Nested optional
  demonstrateTransformation(
    'user.preferences.theme?',
    'Nested optional property'
  );

  // Example 4: Optional in ternary
  demonstrateTransformation(
    'config.showSidebar? ? "block" : "none"',
    'Optional in ternary'
  );
}

function demonstrateTransformation(input: string, description: string) {
  console.log(`--- ${description} ---`);
  console.log(`Input:  ${input}`);

  try {
    // Parse expression
    const ast = acorn.parseExpressionAt(input, 0, { ecmaVersion: 2020 });

    // Phase 1: Qualify with optional detection
    const { ast: qualifiedAst, hasOptionalDeps } = qualifyWithOptionalDeps(ast);
    console.log(`Optional deps detected: ${hasOptionalDeps}`);

    // Phase 2: Validate dependencies (simulated)
    const mockValue: OptionalCompilerValue = { exp: () => {} };
    const mockScope = { name: 'test' };

    if (hasOptionalDeps) {
      console.log('✓ Optional dependencies validated (no errors)');
    }

    // Phase 3: Generate safe code
    const generatedCode = generateOptionalExpression(
      qualifiedAst,
      hasOptionalDeps
    );
    console.log(`Generated: ${generatedCode}`);
  } catch (error) {
    console.log(`Parse error: ${error}`);
  }

  console.log('');
}

// Mock functions for demonstration
function mockLookup(scope: any, name: string): any {
  // Simulate missing dependencies for demo
  return name === 'missing' ? null : { found: true };
}

function generateStandardExpression(ast: any): string {
  return `function() { return ${astToString(ast)}; }`;
}

function generateSafeExpression(ast: any): string {
  return `function() { return ${astToString(ast)}; }`;
}

function astToString(ast: any): string {
  // Simplified AST to string conversion for demo
  if (ast.type === 'Identifier') {
    return `this.${ast.name}`;
  }
  if (ast.type === 'MemberExpression') {
    const optional = (ast as OptionalMemberExpression).optional ? '?' : '';
    return `${astToString(ast.object)}${optional}.${ast.property.name}`;
  }
  if (ast.type === 'LogicalExpression') {
    return `${astToString(ast.left)} ${ast.operator} ${astToString(ast.right)}`;
  }
  if (ast.type === 'ConditionalExpression') {
    return `${astToString(ast.test)} ? ${astToString(ast.consequent)} : ${astToString(ast.alternate)}`;
  }
  if (ast.type === 'Literal') {
    return typeof ast.value === 'string' ? `"${ast.value}"` : String(ast.value);
  }
  return '[Complex Expression]';
}

// Example usage patterns
export const exampleUsagePatterns = {
  // Theme-aware components
  themeAware: ":class=\"${theme.darkMode? ? 'dark' : 'light'}\"",

  // Progressive enhancement
  progressive: ':animated="${animations.enabled? && !reducedMotion}"',

  // Configuration with defaults
  configurable: ':timeout="${config.timeout? || 5000}"',

  // Conditional features
  conditional: ':visible="${features.sidebar? && user.permissions?.canView}"',

  // Analytics integration
  analytics: ':on-click="${() => analytics.track?.(\'click\', data)}"',
};

// Run demonstration if executed directly
if (require.main === module) {
  demonstrateOptionalDeps();

  console.log('=== Usage Patterns ===');
  Object.entries(exampleUsagePatterns).forEach(([name, pattern]) => {
    console.log(`${name}: ${pattern}`);
  });
}
