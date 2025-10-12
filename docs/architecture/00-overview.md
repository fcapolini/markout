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

### Integrated CSS Reactivity
Markout uniquely provides reactive CSS capabilities that dramatically simplify the development ecosystem:

- **Reactive `<style>` Tags**: CSS can include `${...}` expressions for dynamic styling
- **Eliminates CSS Preprocessing**: No need for Sass, Less, or CSS-in-JS solutions
- **Theme Switching**: Easy implementation of dark mode and switchable themes
- **Adaptive Styling**: Responsive breakpoints and device-specific styles
- **Single Source of Truth**: Component logic and styling unified with shared variables
- **CSS Custom Properties**: Dynamic CSS variable values through reactive expressions
- **No CSS-JS Barrier**: Seamless data flow between JavaScript logic and CSS styling

This innovation removes entire categories of tooling complexity while providing capabilities that other frameworks require additional libraries and build steps to achieve.

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

### Effortless Modularization & Componentization
- **Fragment-Based Components**: `<:define>` creates reusable components from any HTML block
- **Automatic Dependency Resolution**: Components import their own dependencies without conflicts
- **Zero-Ceremony Sharing**: Simple `.htm` files work as component libraries
- **Attribute Inheritance**: Parent overrides work intuitively with lexical scoping
- **Inter-Project Libraries**: Same component files work across different projects
- **Company-Wide Design Systems**: Enterprise component libraries with automatic dependency management
- **Self-Documenting**: Component implementations are readable and serve as usage guides
- **No Build Complexity**: Component libraries require no complex build processes or bundling
- **Library Support**: Easy integration with Bootstrap, Shoelace, and third-party libraries

### Integrated Styling
- **Reactive CSS**: `<style>` tags support `${...}` expressions for dynamic styling
- **No Preprocessing**: Eliminates need for Sass, Less, or CSS-in-JS solutions
- **Theme Implementation**: Easy dark mode and switchable themes
- **Ecosystem Simplification**: Removes entire categories of styling tooling complexity
- **Unified Variables**: Shared data between JavaScript logic and CSS styling

### Data Handling
- **`<:data>` Directive**: Sophisticated reactive data system
- **REST Integration**: `<:data :src="/api/users">` for endpoints
- **Local State**: `<:data :json=${{...}}>` for reactive data
- **Business Logic**: Centralized validation and processing

### Enterprise Component Libraries & Design Systems
Markout's modularization architecture provides unique advantages for large-scale development:

- **Company-Wide Libraries**: Share components across teams and projects without complex build processes
- **Design System Implementation**: Turn design systems into simple HTML fragments instead of complex component packages
- **Automatic Dependency Management**: Each component manages its own styles and dependencies
- **No Version Hell**: Components are self-contained `.htm` files that can be versioned independently
- **Cross-Team Collaboration**: Designers and developers can work with the same readable HTML files
- **Zero Setup Cost**: New projects can use component libraries instantly without build configuration
- **Living Documentation**: Component implementations serve as their own usage examples
- **Progressive Enhancement**: Existing HTML can be gradually componentized without rewrites

This approach removes traditional barriers to component sharing between projects and enables true code reuse within organizations.

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
- **Integrated CSS Reactivity**: Built-in reactive styles vs CSS-in-JS libraries (styled-components, emotion)
- **Effortless Modularization**: Simple `.htm` files vs complex component packages and build systems
- **Server-First**: SSR by default, not afterthought
- **Simpler State**: No hooks, context, or complex state management
- **Better Performance**: No re-render cascades or optimization ceremonies
- **Smaller Bundle**: ~5KB runtime vs much larger React bundle
- **Better SEO**: Pre-rendered content works with all indexers
- **Design System Friendly**: HTML fragments vs complex component libraries requiring toolchains
- **Stability**: Built on stable HTML standard vs frequent breaking changes (class components → hooks → server components)

### vs Vue
- **No Template Compilation**: Direct HTML enhancement
- **No Virtual DOM**: Direct DOM updates with batching and deduplication
- **Integrated CSS Reactivity**: Reactive `<style>` tags vs separate CSS preprocessing (Sass, scoped styles)
- **Effortless Modularization**: Zero-ceremony component sharing vs Vue component ecosystem complexity
- **Unified Runtime**: Same code runs on server and client
- **Lexical Scoping**: Variables work naturally without special syntax
- **Framework Independence**: No ceremony or boilerplate
- **Smaller Footprint**: Compiled architecture keeps runtime lean
- **Enterprise Libraries**: Simple inter-project sharing vs Vue component library build processes
- **Stability**: HTML-based foundation vs migration challenges (Vue 2 → Vue 3 Composition API changes)

### vs Svelte
- **Runtime Flexibility**: No compile-time lock-in
- **Integrated CSS Reactivity**: Dynamic CSS expressions vs compile-time CSS transformations
- **Effortless Modularization**: Self-contained HTML fragments vs Svelte's compile-time component system
- **Smaller Runtime**: ~5KB vs Svelte's compiled output size
- **Server Rendering**: Full SSR without separate build
- **Component Simplicity**: HTML fragments instead of special formats
- **Development Speed**: No build step required for development
- **Cross-Project Sharing**: Simple file sharing vs Svelte component compilation requirements
- **Stability**: Stable HTML enhancement vs evolving compile-time transformations (runes, SvelteKit changes)

## Stability-First Architecture

The Markout architecture prioritizes developer experience, performance, and **long-term stability** over following the latest trends. This stability advantage comes from:

- **HTML Foundation**: Built on the stable HTML standard that has evolved gracefully for decades
- **Extensive Validation**: Long series of proofs-of-concept validated architectural choices before implementation
- **Stability Principle**: Framework stability is a core design principle, not an afterthought
- **Thoughtful Evolution**: "Thought it out before pushing it out" approach prevents breaking changes

Unlike other frameworks that frequently introduce breaking changes requiring costly migrations, Markout's HTML-first approach provides a stable foundation that evolves naturally with web standards. Every architectural decision is made with these principles in mind, resulting in a framework that's both powerful and approachable for the long term.