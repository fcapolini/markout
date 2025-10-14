/**
 * Test runner for the foreach comment markers prototype
 * Run with: npx ts-node prototypes/foreach-comment-markers-test.ts
 */

import {
  ForeachPrototypeParser,
  generateForeachMarkers,
  parseForeachMarker,
} from './foreach-comment-markers';

function runTests(): void {
  console.log('🧪 Testing Foreach Comment Markers Prototype\n');

  testMarkerGeneration();
  testMarkerParsing();
  testHTMLTransformation();
  testCSSCompatibility();
}

function testMarkerGeneration(): void {
  console.log('✅ Test 1: Marker Generation');

  const markers = generateForeachMarkers('123');
  console.log('Generated markers:', markers);

  const expectedStart = '<!---foreach-start-123-->';
  const expectedEnd = '<!---foreach-end-123-->';

  if (markers.start === expectedStart && markers.end === expectedEnd) {
    console.log('✅ Marker generation works correctly\n');
  } else {
    console.log('❌ Marker generation failed\n');
  }
}

function testMarkerParsing(): void {
  console.log('✅ Test 2: Marker Parsing');

  const startComment = '---foreach-start-456---';
  const endComment = '---foreach-end-456---';
  const invalidComment = '---not-a-foreach-marker---';

  const startResult = parseForeachMarker(startComment);
  const endResult = parseForeachMarker(endComment);
  const invalidResult = parseForeachMarker(invalidComment);

  console.log('Start marker parsed:', startResult);
  console.log('End marker parsed:', endResult);
  console.log('Invalid marker parsed:', invalidResult);

  if (
    startResult?.type === 'foreach-start' &&
    startResult?.scopeId === '456' &&
    endResult?.type === 'foreach-end' &&
    endResult?.scopeId === '456' &&
    invalidResult === null
  ) {
    console.log('✅ Marker parsing works correctly\n');
  } else {
    console.log('❌ Marker parsing failed\n');
  }
}

function testHTMLTransformation(): void {
  console.log('✅ Test 3: HTML Transformation');

  const parser = new ForeachPrototypeParser();

  const inputHTML = `<div class="list">
  <h2>Items:</h2>
  <p :foreach=\${items}>\${data}</p>
  <footer>End of list</footer>
</div>`;

  console.log('Input HTML:');
  console.log(inputHTML);
  console.log();

  const transformed = parser.transformForeachToMarkers(inputHTML);
  console.log('Transformed HTML:');
  console.log(transformed);
  console.log();

  const processed = parser.processForeachMarkers(transformed, {
    '100': ['Apple', 'Banana', 'Cherry'],
  });
  console.log('Final processed HTML:');
  console.log(processed);
  console.log();
}

function testCSSCompatibility(): void {
  console.log('✅ Test 4: CSS Compatibility Demo');

  // Simulate CSS selector behavior
  const currentDOM = [
    { type: 'p', content: 'First item' },
    { type: 'template', content: '(foreach wrapper)' },
    { type: 'p', content: 'Last item' },
  ];

  const proposedDOM = [
    { type: 'p', content: 'First item' },
    { type: 'p', content: 'Loop item 1' },
    { type: 'p', content: 'Loop item 2' },
    { type: 'p', content: 'Last item' },
  ];

  console.log('Current DOM structure (with template):');
  currentDOM.forEach((node, i) => {
    const isLastChild = i === currentDOM.length - 1;
    const isLastParagraph =
      node.type === 'p' && currentDOM.slice(i + 1).every(n => n.type !== 'p');
    console.log(
      `  ${node.type}: "${node.content}" (last-child: ${isLastChild}, last p: ${isLastParagraph})`
    );
  });

  console.log('\nProposed DOM structure (comment markers removed):');
  proposedDOM.forEach((node, i) => {
    const isLastChild = i === proposedDOM.length - 1;
    const isLastParagraph =
      node.type === 'p' && proposedDOM.slice(i + 1).every(n => n.type !== 'p');
    console.log(
      `  ${node.type}: "${node.content}" (last-child: ${isLastChild}, last p: ${isLastParagraph})`
    );
  });

  console.log('\n🎯 CSS Impact:');
  console.log('- Current: p:last-child selects "First item" (wrong!)');
  console.log('- Proposed: p:last-child selects "Last item" (correct!)');
  console.log();
}

function demonstrateImplementationPlan(): void {
  console.log('📋 Implementation Plan:\n');

  console.log('1. Update src/compiler/loader.ts:');
  console.log(
    '   - Replace ServerTemplateElement creation with comment insertion'
  );
  console.log('   - Use generateForeachMarkers() for consistent format\n');

  console.log('2. Update src/html/server-dom.ts:');
  console.log('   - Remove special ServerTemplateElement.toMarkup() logic');
  console.log('   - Ensure comment nodes render properly\n');

  console.log('3. Update src/runtime/web/web-scope.ts:');
  console.log('   - Add foreach marker detection and processing');
  console.log(
    '   - Clone content between markers instead of template children\n'
  );

  console.log('4. Update tests:');
  console.log('   - tests/compiler/loader/201-* (foreach transformation)');
  console.log('   - tests/compiler/generator/007-*, 008-* (nested foreach)');
  console.log('   - Add CSS compatibility integration tests\n');

  console.log('5. Update documentation:');
  console.log('   - Remove :last-child caveat from README.md');
  console.log('   - Add examples showing improved CSS compatibility');
  console.log('   - Update copilot-instructions.md');
}

// Run the tests
if (require.main === module) {
  runTests();
  demonstrateImplementationPlan();
}

export { runTests };
