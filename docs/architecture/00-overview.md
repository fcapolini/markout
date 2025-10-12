# Markout Framework Architecture Overview

This document provides a comprehensive overview of the Markout framework architecture, complementing the detailed C4 diagrams in this directory.

## Architecture Philosophy

Markout is built on several key architectural principles that distinguish it from other web frameworks:

### HTML-First Approach
Rather than replacing HTML with JavaScript abstractions, Markout enhances HTML with three minimal additions:
- **Directives**: `<:import>`, `<:define>` for modularity
- **Logic Values**: `:` prefixed attributes for reactive state
- **Reactive Expressions**: `${...}` syntax for dynamic content

### Polymorphic Execution
The same reactive logic runs identically on server and client:
- Server pre-renders pages with full reactive logic
- Client hydrates seamlessly from server state
- No separate server/client codebases required

### Hierarchical Scoping
Variables work as developers expect through lexical scoping:
- Compiler auto-transforms expressions for reactive system
- `$parent` access follows natural parent-child relationships
- Framework uses `$` namespace to avoid naming conflicts

## System Architecture Layers

### 1. Development Layer
- **CLI Tool**: `markout serve` for development, PM2 for production
- **VS Code Extension** (planned): Syntax highlighting, IntelliSense, debugging
- **Build System**: esbuild for fast TypeScript compilation

### 2. Server Layer
- **Express.js Server**: HTTP serving with middleware pipeline
- **Rate Limiting**: DoS protection and API throttling
- **Process Management**: PM2 clustering with health monitoring
- **Static Assets**: Compressed delivery of CSS/JS/images

### 3. Compilation Layer
- **HTML Preprocessor**: Module loading, fragment imports
- **Multi-Phase Compiler**: 7-phase compilation pipeline
- **AST Analysis**: Acorn parser for JavaScript expressions
- **Dependency Resolution**: Reactive value relationships

### 4. Runtime Layer
- **Server Runtime**: Reactive execution with server DOM
- **Client Runtime**: Browser hydration and updates (~5KB footprint)
- **No Virtual DOM**: Surgical DOM updates with batching and deduplication
- **Update Batching**: Set-based deduplication system
- **Dependency Tracking**: Proxy-based automatic detection

## Key Architectural Innovations

### Multi-Phase Compilation Pipeline
Unlike single-pass compilers, Markout uses a sophisticated 7-phase approach:

1. **Load**: Parse HTML structure and extract reactive elements
2. **Validate**: Enforce framework rules and naming conventions
3. **Qualify**: Auto-transform expressions for lexical scoping
4. **Resolve**: Build dependency graphs for reactive updates
5. **Comptime**: Compile-time evaluation (future optimization)
6. **Treeshake**: Remove unused code and optimize hierarchy
7. **Generate**: Output executable BaseScopeProps structures

This approach enables sophisticated optimizations while maintaining clear separation of concerns.

### No Virtual DOM - Surgical DOM Updates
Unlike frameworks that re-render entire component trees and rely on Virtual DOM diffing, Markout uses a fundamentally different approach:

- **Surgical Updates**: Knows exactly what needs updating through reactive dependency tracking
- **No Re-rendering**: Components don't re-execute when unrelated state changes
- **Batched Operations**: Multiple DOM updates batched into single layout/paint cycle
- **Automatic Deduplication**: Set-based system prevents redundant DOM operations
- **Superior Performance**: Updates are proportional to actual changes, not component tree size
- **Small Runtime**: ~5KB client runtime thanks to compiled architecture and efficient design

This eliminates the common performance pitfalls of Virtual DOM frameworks without requiring optimization ceremonies like `React.memo`, `useMemo`, or `useCallback`.

### Pull-Based Reactive System
Markout uses a pull-based reactive system with hierarchical scopes:

- **BaseContext**: Central coordinator managing refresh cycles
- **BaseScope**: Hierarchical scopes with proxy-based access
- **BaseValue**: Reactive values with lazy evaluation
- **Dependency Tracking**: Automatic detection via Proxy system
- **Update Batching**: Set-based deduplication prevents redundant DOM updates

### Reserved Namespace System
Framework uses `$` as reserved namespace to prevent conflicts:

- **User Code**: Cannot declare identifiers starting with `$`
- **Framework Access**: Users can access `$parent`, `$value()` etc.
- **Triple-Dash Comments**: `<!---...-->` for conflict-free code generation
- **Clean Separation**: Framework and user code remain distinct

## Performance Characteristics

### Compilation Performance
- **On-demand Compilation**: Pages compiled only when requested
- **Caching**: Compiled results cached in memory
- **Fast AST Processing**: Acorn parser optimized for expressions
- **Incremental Updates**: Only recompile changed dependencies

### Runtime Performance
- **No Virtual DOM**: Uses surgical, batched, and deduplicated DOM updates for superior performance
- **Batched Updates**: Set-based deduplication prevents redundant DOM operations
- **Surgical Updates**: Only changed values trigger DOM updates, proportional to actual changes
- **Lazy Evaluation**: Reactive values computed only when needed
- **Efficient Scoping**: Proxy-based access with minimal overhead
- **Small Footprint**: ~5KB runtime thanks to compiled architecture and well-designed runtime
- **Memory Management**: Automatic cleanup of unused dependencies

### Server Performance
- **PM2 Clustering**: Full CPU utilization across cores
- **Response Caching**: Aggressive caching for repeated requests
- **Compression**: Gzip/Brotli for reduced bandwidth
- **Static Assets**: Optimized delivery with proper caching headers

## Development Experience

### Zero-Ceremony Development
- **No Build Step**: HTML files work directly with `markout serve`
- **No Boilerplate**: Minimal syntax additions to standard HTML
- **Natural Scoping**: Variables work as developers expect
- **Instant Feedback**: Hot reload during development

### Component System
- **Fragment-Based**: `<:define>` creates reusable components
- **Automatic Imports**: Dependencies resolved automatically
- **Attribute Inheritance**: Parent overrides work intuitively
- **Library Support**: Easy integration with Bootstrap, Shoelace, etc.

### Data Handling
- **`<:data>` Directive**: Sophisticated reactive data system
- **REST Integration**: `<:data :src="/api/users">` for endpoints
- **Local State**: `<:data :json=${{...}}>` for reactive data
- **Business Logic**: Centralized validation and processing

## Production Readiness

### Security
- **Rate Limiting**: Configurable limits for different endpoint types
- **Input Validation**: Automatic sanitization of user inputs
- **Security Headers**: CSRF, XSS protection
- **Dependency Scanning**: Automated vulnerability detection

### Monitoring & Operations
- **Health Checks**: `/health` endpoint for load balancers
- **Structured Logging**: JSON format with proper levels
- **Process Management**: PM2 with automatic restart
- **Graceful Shutdown**: Proper cleanup on deployment

### Testing
- **178+ Tests**: Comprehensive test coverage
- **Cross-Platform**: Windows, macOS, Linux compatibility
- **CI/CD Pipeline**: GitHub Actions with security scanning
- **Coverage Reporting**: V8 coverage with detailed metrics

## Future Roadmap

### Tooling Enhancements
- **VS Code Extension**: Advanced development support
- **Type System**: TypeScript integration for reactive values
- **Debugging Tools**: Visual dependency graphs and scope inspection
- **Performance Profiler**: Runtime performance analysis

### Runtime Optimizations
- **Comptime Evaluation**: More aggressive compile-time optimization
- **Bundle Splitting**: Code splitting for large applications
- **Service Worker**: PWA support with offline capabilities
- **WebAssembly**: Performance-critical operations in WASM

### Ecosystem Growth
- **Component Libraries**: Pre-built UI component collections
- **Template Gallery**: Project templates for common patterns
- **Plugin System**: Extensible architecture for custom functionality
- **Documentation**: Comprehensive guides and tutorials

## Comparison with Other Frameworks

### vs React
- **No JSX**: Uses enhanced HTML instead of JavaScript syntax
- **No Virtual DOM**: Surgical DOM updates vs diffing algorithms
- **Server-First**: SSR by default, not afterthought
- **Simpler State**: No hooks, context, or complex state management
- **Better Performance**: No re-render cascades or optimization ceremonies
- **Smaller Bundle**: ~5KB runtime vs much larger React bundle
- **Better SEO**: Pre-rendered content works with all indexers

### vs Vue
- **No Template Compilation**: Direct HTML enhancement
- **No Virtual DOM**: Direct DOM updates with batching and deduplication
- **Unified Runtime**: Same code runs on server and client
- **Lexical Scoping**: Variables work naturally without special syntax
- **Framework Independence**: No ceremony or boilerplate
- **Smaller Footprint**: Compiled architecture keeps runtime lean

### vs Svelte
- **Runtime Flexibility**: No compile-time lock-in
- **Smaller Runtime**: ~5KB vs Svelte's compiled output size
- **Server Rendering**: Full SSR without separate build
- **Component Simplicity**: HTML fragments instead of special formats
- **Development Speed**: No build step required for development

The Markout architecture prioritizes developer experience, performance, and long-term stability over following the latest trends. Every architectural decision is made with these principles in mind, resulting in a framework that's both powerful and approachable.