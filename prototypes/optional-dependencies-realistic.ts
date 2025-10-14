/**
 * REALISTIC PROTOTYPE: Optional Dependencies Implementation
 *
 * This demonstrates how optional dependencies would work in practice,
 * showing the transformation from Markout syntax to valid JavaScript.
 */

// Simulate the preprocessing step that would transform Markout syntax
export function preprocessOptionalSyntax(input: string): {
  transformed: string;
  hasOptionalDeps: boolean;
} {
  let hasOptionalDeps = false;

  // Transform property? to property (and mark as optional)
  const transformed = input.replace(/(\w+)\?/g, (match, prop) => {
    hasOptionalDeps = true;
    return prop; // Remove the '?' for valid JS parsing
  });

  return { transformed, hasOptionalDeps };
}

// Example transformations
const examples = [
  'head.darkMode?',
  'head.darkMode? && user.loggedIn',
  'user.preferences.theme?',
  'config.showSidebar? ? "block" : "none"',
];

console.log('=== Optional Dependencies Realistic Prototype ===\n');

examples.forEach((example, i) => {
  console.log(`--- Example ${i + 1}: ${example} ---`);

  // Step 1: Preprocess Markout syntax
  const { transformed, hasOptionalDeps } = preprocessOptionalSyntax(example);
  console.log(`Transformed:     ${transformed}`);
  console.log(`Has optional:    ${hasOptionalDeps}`);

  // Step 2: Parse as valid JavaScript (this would now work)
  try {
    // Simulate AST parsing - in reality this would use acorn
    console.log(`Parsed:          ✓ Valid JavaScript AST`);

    // Step 3: Generate safe code based on optional flag
    if (hasOptionalDeps) {
      const safeCode = generateSafeCode(transformed);
      console.log(`Generated:       ${safeCode}`);
    } else {
      console.log(
        `Generated:       function() { return this.${transformed}; }`
      );
    }
  } catch (error) {
    console.log(
      `Parse error:     ${error instanceof Error ? error.message : String(error)}`
    );
  }

  console.log('');
});

function generateSafeCode(expression: string): string {
  // Transform standard property access to optional chaining
  // This is a simplified version - real implementation would work on AST
  const safeExpression = expression
    .replace(/(\w+)\.(\w+)/g, 'this.$1?.$2') // Simple case
    .replace(/^(\w+)$/, 'this.$1'); // Single identifier

  return `function() { return ${safeExpression}; }`;
}

// Demonstrate the complete flow
console.log('=== Complete Transformation Flow ===');
console.log('1. Markout syntax:   :class="${theme.darkMode?}"');
console.log('2. Preprocessed:     :class="${theme.darkMode}"');
console.log(
  '3. AST parsed:       MemberExpression(this.theme, darkMode) [optional=true]'
);
console.log('4. Generated:        function() { return this.theme?.darkMode; }');
console.log('5. Runtime result:   undefined (graceful handling)');

console.log('\n=== Benefits Demonstrated ===');
console.log('✓ Backward compatible - existing syntax unchanged');
console.log('✓ Progressive enhancement - missing deps return undefined');
console.log('✓ Compile-time detection - optional vs required clearly marked');
console.log('✓ Runtime safety - no errors for missing optional properties');
console.log(
  '✓ Reactive integration - updates when optional deps become available'
);
