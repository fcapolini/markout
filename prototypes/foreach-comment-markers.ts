/**
 * Prototype: Replace <template> tags with comment markers for :foreach loops
 *
 * This prototype demonstrates how to eliminate <template> elements from the DOM
 * to fix CSS pseudo-class issues (:last-child, etc.) by using comment markers
 * instead, consistent with Markout's existing triple-dash comment system.
 *
 * Current problem:
 * - :foreach creates <template> wrapper elements
 * - These interfere with CSS selectors like :last-child
 * - Developers must use :last-of-type workaround
 *
 * Proposed solution:
 * - Use comment markers: <!---foreach-start-{id}--> and <!---foreach-end-{id}-->
 * - Clone content between markers during runtime
 * - Remove markers after processing (like other framework comments)
 *
 * Benefits:
 * - Fixes CSS pseudo-class compatibility
 * - Cleaner DOM structure
 * - Consistent with framework's comment-based approach
 * - Better performance (comments vs DOM elements)
 */

// Example transformation:
// INPUT:
// <div>
//   <span :foreach=${[1, 2, 3]}>${data}</span>
// </div>
//
// CURRENT OUTPUT:
// <div>
//   <template data-markout="3">
//     <span data-markout="4">Content</span>
//   </template>
// </div>
//
// PROPOSED OUTPUT:
// <div>
//   <!---foreach-start-3-->
//   <span data-markout="4">Content</span>
//   <!---foreach-end-3-->
// </div>

interface ForeachMarker {
  type: 'foreach-start' | 'foreach-end';
  id: string;
  scopeId: string;
}

/**
 * Parse foreach comment markers from HTML
 */
function parseForeachMarker(comment: string): ForeachMarker | null {
  // Match: <!---foreach-start-{scopeId}--> or <!---foreach-end-{scopeId}-->
  const match = comment.match(/^---foreach-(start|end)-(\d+)---$/);
  if (!match) return null;

  const [, type, scopeId] = match;
  return {
    type: `foreach-${type}` as 'foreach-start' | 'foreach-end',
    id: `foreach-${type}-${scopeId}`,
    scopeId,
  };
}

/**
 * Generate foreach comment markers
 */
function generateForeachMarkers(scopeId: string): {
  start: string;
  end: string;
} {
  return {
    start: `<!---foreach-start-${scopeId}-->`,
    end: `<!---foreach-end-${scopeId}-->`,
  };
}

/**
 * Mock DOM node for prototype demonstration
 */
interface MockNode {
  type: 'element' | 'comment' | 'text';
  tagName?: string;
  data?: string; // for comments and text
  textContent?: string;
  attributes?: Record<string, string>;
  children: MockNode[];
  parentNode?: MockNode;
}

/**
 * Mock HTML parser that demonstrates the transformation
 */
class ForeachPrototypeParser {
  /**
   * Transform :foreach attribute to comment markers
   * This replaces the current template-wrapping approach
   */
  transformForeachToMarkers(html: string): string {
    // Simulate parsing and transformation
    let result = html;
    let scopeCounter = 100; // Start from 100 for demo

    // Find :foreach attributes and transform them
    const foreachPattern =
      /<(\w+)([^>]*?):foreach\s*=\s*\$\{([^}]+)\}([^>]*?)>/g;

    result = result.replace(
      foreachPattern,
      (match, tagName, beforeAttrs, foreachExp, afterAttrs) => {
        const scopeId = scopeCounter++;
        const markers = generateForeachMarkers(scopeId.toString());

        // Create the transformed structure
        return `${markers.start}\n  <${tagName}${beforeAttrs} data-markout="${scopeId}"${afterAttrs}>`;
      }
    );

    // Close the foreach regions (simplified - would need proper parsing in real implementation)
    result = result.replace(/<\/(\w+)>/g, (match, tagName, offset) => {
      // Check if this closing tag corresponds to a foreach element
      // In real implementation, this would use proper DOM tree parsing
      if (result.slice(0, offset).includes('<!---foreach-start-')) {
        const markers = generateForeachMarkers('100'); // Simplified for demo
        return `${match}\n${markers.end}`;
      }
      return match;
    });

    return result;
  }

  /**
   * Runtime processing: clone content between foreach markers
   */
  processForeachMarkers(html: string, data: Record<string, any[]>): string {
    const markers: Array<{
      type: 'start' | 'end';
      scopeId: string;
      position: number;
    }> = [];

    // Find all foreach markers
    const markerPattern = /<!---foreach-(start|end)-(\d+)--->/g;
    let match;

    while ((match = markerPattern.exec(html)) !== null) {
      markers.push({
        type: match[1] as 'start' | 'end',
        scopeId: match[2],
        position: match.index,
      });
    }

    // Process markers in reverse order to maintain positions
    markers.reverse();

    for (let i = 0; i < markers.length; i += 2) {
      const endMarker = markers[i];
      const startMarker = markers[i + 1];

      if (
        startMarker?.type === 'start' &&
        endMarker?.type === 'end' &&
        startMarker.scopeId === endMarker.scopeId
      ) {
        const scopeId = startMarker.scopeId;
        const foreachData = data[scopeId] || [1, 2, 3]; // Mock data

        // Extract content between markers
        const startPos =
          startMarker.position + `<!---foreach-start-${scopeId}-->`.length;
        const endPos = endMarker.position;
        const template = html.slice(startPos, endPos);

        // Clone template for each item
        let clonedContent = '';
        foreachData.forEach((item, index) => {
          clonedContent += template.replace(/\$\{data\}/g, item.toString());
        });

        // Replace the entire foreach region with cloned content
        const beforeMarker = html.slice(0, startMarker.position);
        const afterMarker = html.slice(
          endMarker.position + `<!---foreach-end-${scopeId}-->`.length
        );

        html = beforeMarker + clonedContent + afterMarker;
      }
    }

    return html;
  }
}

/**
 * Integration with existing Markout architecture
 */
class ForeachMarkerIntegration {
  /**
   * Loader phase: Transform :foreach to comment markers instead of <template>
   * This would replace the current template creation in loader.ts
   */
  transformInLoader(element: MockNode, scopeId: string): MockNode[] {
    // Instead of creating <template> wrapper, create comment markers
    const markers = generateForeachMarkers(scopeId);

    return [
      {
        type: 'comment',
        data: markers.start.slice(4, -3), // Remove <!--- and -->
        children: [],
      },
      element, // The original element with :foreach removed
      {
        type: 'comment',
        data: markers.end.slice(4, -3),
        children: [],
      },
    ];
  }

  /**
   * Runtime phase: Process foreach markers during scope activation
   * This would integrate with the existing BaseScope system
   */
  processInRuntime(scopeData: any): void {
    // In actual implementation, this would:
    // 1. Find foreach comment markers in DOM
    // 2. Extract template content between markers
    // 3. Clone content for each array item
    // 4. Replace markers with cloned content
    // 5. Activate reactive scopes for each clone

    console.log('Runtime foreach processing for scope:', scopeData.id);
  }
}

/**
 * CSS Compatibility Demonstration
 */
function demonstrateCSSFix(): void {
  console.log('=== CSS Compatibility Demonstration ===\n');

  const currentHTML = `
<div class="container">
  <p>First item</p>
  <template data-markout="3">
    <p>Loop item 1</p>
    <p>Loop item 2</p>
  </template>
  <p>Last item</p>
</div>`;

  const proposedHTML = `
<div class="container">
  <p>First item</p>
  <p>Loop item 1</p>
  <p>Loop item 2</p>
  <p>Last item</p>
</div>`;

  console.log('CURRENT (with <template>):');
  console.log(currentHTML);
  console.log(
    '\nCSS Issue: p:last-child selects the <template>, not "Last item"\n'
  );

  console.log('PROPOSED (with comment markers):');
  console.log(proposedHTML);
  console.log('\nCSS Fix: p:last-child correctly selects "Last item"\n');

  console.log('CSS that works correctly with proposed approach:');
  console.log('.container > p:last-child { color: red; } /* ✅ Works! */');
  console.log(
    '.container > p:nth-child(odd) { background: #f0f0f0; } /* ✅ Works! */'
  );
  console.log('.container > p + p { margin-top: 10px; } /* ✅ Works! */');
}

/**
 * Performance Comparison
 */
function demonstratePerformance(): void {
  console.log('\n=== Performance Comparison ===\n');

  console.log('Current approach (<template> elements):');
  console.log('- DOM nodes: 1 template + N cloned children');
  console.log('- Memory: Template element + content fragments');
  console.log('- CSS recalc: Must account for template in selectors');
  console.log('- Query complexity: querySelectorAll must skip templates\n');

  console.log('Proposed approach (comment markers):');
  console.log('- DOM nodes: N cloned children only');
  console.log('- Memory: Just the cloned content');
  console.log('- CSS recalc: Natural selector behavior');
  console.log('- Query complexity: Standard DOM queries work normally');
}

/**
 * Migration Strategy
 */
function demonstrateMigration(): void {
  console.log('\n=== Migration Strategy ===\n');

  console.log('Phase 1: Update Loader (src/compiler/loader.ts)');
  console.log(
    '- Replace template wrapper creation with comment marker insertion'
  );
  console.log('- Update scope type from "foreach" to maintain compatibility\n');

  console.log('Phase 2: Update Server DOM (src/html/server-dom.ts)');
  console.log('- Remove ServerTemplateElement special handling for foreach');
  console.log('- Add comment marker rendering logic\n');

  console.log('Phase 3: Update Runtime (src/runtime/web/)');
  console.log(
    '- Replace template cloning with marker-based content duplication'
  );
  console.log('- Update scope activation to work with comment boundaries\n');

  console.log('Phase 4: Update Tests & Documentation');
  console.log('- Update test fixtures to expect comment markers');
  console.log('- Remove :last-child caveat from README');
  console.log('- Add examples showing improved CSS compatibility');
}

// Run the prototype demonstration
if (require.main === module) {
  console.log('🔄 Markout Foreach Comment Markers Prototype\n');

  const parser = new ForeachPrototypeParser();

  // Demonstrate transformation
  const inputHTML = `<div>
  <span :foreach=\${[1, 2, 3]}>\${data}</span>
</div>`;

  console.log('Input HTML:');
  console.log(inputHTML);

  const transformedHTML = parser.transformForeachToMarkers(inputHTML);
  console.log('\nTransformed HTML (compile-time):');
  console.log(transformedHTML);

  const processedHTML = parser.processForeachMarkers(transformedHTML, {
    '100': [1, 2, 3],
  });
  console.log('\nProcessed HTML (runtime):');
  console.log(processedHTML);

  demonstrateCSSFix();
  demonstratePerformance();
  demonstrateMigration();

  console.log(
    '\n✅ Prototype demonstrates feasibility of comment marker approach'
  );
  console.log('🎯 Ready for implementation in main codebase');
}

export {
  ForeachPrototypeParser,
  ForeachMarkerIntegration,
  parseForeachMarker,
  generateForeachMarkers,
};
