# Fragment Library Publishing and Module Integration

## Overview

This document outlines Markout's strategy for publishing official fragment-based libraries and handling JavaScript module integration for both client-side and server-side rendering scenarios.

## Fragment Library Publishing Strategy

### NPM Package Distribution

**Official Markout Library Packages:**
```
@markout-js/cli                 # Core CLI and framework (existing)
@markout-js/ui-bootstrap        # Bootstrap integration components
@markout-js/ui-shoelace         # Shoelace Web Components integration  
@markout-js/data-graphql        # GraphQL client libraries
@markout-js/data-websockets     # WebSocket communication libraries
@markout-js/data-validation     # Valibot validation libraries
@markout-js/data-async          # Server-Sent Events, IndexedDB, WebRTC
```

**Community and Company Packages:**
```
markout-*                       # Community packages
@company/markout-*              # Company-specific packages
```

### Library Structure Example

```
@markout-js/ui-bootstrap/
├── package.json
├── README.md
├── lib/
│   ├── bootstrap.htm           # Main bootstrap integration
│   ├── components/
│   │   ├── button.htm          # Bootstrap button component
│   │   ├── modal.htm           # Bootstrap modal component
│   │   ├── form.htm            # Bootstrap form components
│   │   └── navigation.htm      # Navigation components
│   └── themes/
│       ├── dark.htm            # Dark theme variant
│       └── custom.htm          # Customizable theme
├── examples/
│   ├── basic-usage.html        # Simple examples
│   └── advanced-patterns.html  # Complex patterns
└── docs/
    └── api-reference.md        # Component documentation
```

### Usage Pattern

**Installation:**
```bash
npm install @markout-js/ui-bootstrap
npm install @markout-js/data-validation
```

**Usage in Markout applications:**
```html
<!-- Import from node_modules -->
<:import src="@markout-js/ui-bootstrap/lib/bootstrap.htm" />
<:import src="@markout-js/data-validation/lib/validation.htm" />

<!-- Use the components -->
<:bootstrap-button :variant="primary" :on-click="${() => handleClick()}">
  Click Me
</:bootstrap-button>

<:validated-form :schema="${userSchema}" :on-submit="${handleSubmit}">
  <!-- form content -->
</:validated-form>
```

## Preprocessor Enhancement for node_modules

### Required Modifications to preprocessor.ts

The preprocessor needs significant enhancement to support both package resolution and VS Code extension integration with comprehensive diagnostics.

**Enhanced Package Resolution Interface:**
```typescript
export interface PreprocessorOptions {
  docroot: string;
  enableDiagnostics?: boolean;
  allowedPackagePatterns?: string[];
  packageResolutionCache?: Map<string, PackageInfo>;
}

export interface ImportDiagnostic extends PageError {
  category: 'import-resolution';
  code: ImportErrorCode;
  resolvedPath?: string;
  suggestions?: string[];
  packageInfo?: PackageInfo;
}

export enum ImportErrorCode {
  PACKAGE_NOT_FOUND = 'package-not-found',
  PACKAGE_NOT_ALLOWED = 'package-not-allowed', 
  FILE_NOT_FOUND = 'file-not-found',
  CIRCULAR_DEPENDENCY = 'circular-dependency',
  INVALID_PACKAGE_NAME = 'invalid-package-name'
}
```

**Package Path Detection:**
```typescript
function isPackagePath(fname: string): boolean {
  // Scoped packages: @markout-js/package-name
  if (fname.startsWith('@')) return true;
  // Unscoped packages: markout-package-name
  if (!fname.startsWith('.') && !fname.startsWith('/')) return true;
  return false;
}
```

**Enhanced Node.js Module Resolution:**
```typescript
class PackageResolver {
  static async resolvePackage(
    packagePath: string,
    fromDir: string,
    options: PreprocessorOptions
  ): Promise<PackageResolutionResult> {
    // Detailed resolution with comprehensive diagnostics
    // See vscode-extension-integration.md for full implementation
  }
}
```

**VS Code Integration Considerations:**
- Enhanced error reporting with ImportDiagnostic types
- Package discovery and caching for IntelliSense
- Comprehensive suggestion system for quick fixes
- Fragment analysis for component parameter completion
- Performance optimization for real-time diagnostics

See `docs/specifications/vscode-extension-integration.md` for detailed VS Code Language Server Protocol integration requirements.

## JavaScript Module Integration

### Current Capabilities

**Static File Serving + ES6 Imports (Works Today):**
```html
<!-- Custom utilities served as static files -->
<script type="module">
  import { formatCurrency, debounce } from '/js/utils.js';
  import { apiClient } from '/lib/api-client.js';
  
  // Make available for Markout expressions
  globalThis.formatCurrency = formatCurrency;
  globalThis.apiClient = apiClient;
</script>

<!-- Use in reactive expressions -->
<div :price="${29.99}">
  Price: ${formatCurrency(price)}
</div>
```

**Fragment-Wrapped Libraries (Recommended Pattern):**
```html
<!-- lib/my-utilities.htm -->
<lib>
  <script>
    // Universal implementation (SSR + CSR compatible)
    function formatCurrency(amount, currency = 'USD') {
      if (typeof Intl !== 'undefined') {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: currency
        }).format(amount);
      }
      return `$${amount.toFixed(2)}`;
    }
    globalThis.formatCurrency = formatCurrency;
  </script>
  
  <script type="module">
    // Browser enhancement
    try {
      const { enhancedFormatCurrency } = await import('/js/currency-utils.js');
      globalThis.formatCurrency = enhancedFormatCurrency;
    } catch (e) {
      // Fallback to basic implementation
    }
  </script>
</lib>
```

### SSR Considerations

**Current SSR Implementation:**
- Uses lightweight `eval()` execution in Node.js context
- No ES6 module support in SSR environment
- Limited to globals provided by framework

**SSR Limitations with Custom Modules:**
```html
<!-- This works in browser but breaks SSR -->
<script type="module">
  import { formatCurrency } from '/js/utils.js';
  globalThis.formatCurrency = formatCurrency;
</script>

<!-- SSR fails here because server can't execute ES6 imports -->
<div>${formatCurrency(29.99)}</div>
```

**Recommended SSR-Safe Pattern:**
```html
<!-- Polymorphic implementation works in both SSR and CSR -->
<div :price="${29.99}">
  <template :if="${typeof formatCurrency !== 'undefined'}">
    Price: ${formatCurrency(price)}
  </template>
  <template :else>
    Price: $${price.toFixed(2)}
  </template>
</div>

<script type="module">
  // Enhanced client-side functionality
  import { formatCurrency } from '/js/utils.js';
  globalThis.formatCurrency = formatCurrency;
</script>
```

### Future SSR Enhancement Options

**Option 1: Enhanced Fragment Libraries (Current Recommendation)**
- Polymorphic implementations that work on both server and client
- Progressive enhancement pattern
- Maintains current lightweight SSR performance

**Option 2: Server-Side Module Resolution (Future v0.3.x+)**
- Enhanced SSR with Node.js module resolution
- Custom module loader for server execution
- Significant implementation complexity

**Option 3: Happy DOM SSR (Future v0.4.x+)**
- Full browser environment for SSR using Happy DOM
- Natural ES6 module support (when Happy DOM implements it)
- Higher performance cost but complete compatibility

## Ecosystem Architecture Benefits

### Library-First Philosophy
- **Zero Bloat**: Only imported libraries add to bundle
- **Selective Enhancement**: Import only needed capabilities  
- **Community Growth**: Standard patterns for sharing components
- **Enterprise Ready**: Company libraries follow same patterns

### Fragment Benefits Over Direct JS Files
1. **Encapsulation**: Libraries manage their own dependencies
2. **Documentation**: Fragments serve as usage documentation
3. **Configuration**: Library setup and initialization handled once
4. **Consistency**: Same pattern for all integrations
5. **Security**: Controlled, whitelisted packages only

## Implementation Timeline

### v0.2.x: Node.js Package Resolution
- [ ] Enhance preprocessor.ts with package resolution
- [ ] Add security validation for allowed packages
- [ ] Test fragment imports from node_modules
- [ ] Update documentation and examples

### v0.3.x: Official Library Packages
- [ ] Publish @markout-js/ui-bootstrap
- [ ] Publish @markout-js/data-validation  
- [ ] Publish @markout-js/ui-shoelace
- [ ] Establish publishing workflow and guidelines

### v0.4.x: Advanced SSR (Optional)
- [ ] Evaluate Happy DOM for enhanced SSR
- [ ] Consider custom module resolution for server
- [ ] Performance analysis and optimization

## Conclusion

The fragment-based library approach provides an optimal balance between simplicity, power, and maintainability. By enhancing the preprocessor to resolve packages from node_modules and maintaining SSR compatibility through polymorphic fragments, Markout can build a rich ecosystem while preserving its core design principles of simplicity and zero-ceremony development.