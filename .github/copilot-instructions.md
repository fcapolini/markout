# Markout - HTML-First Reactive Web Framework

This is Markout, an alternative HTML-based reactive web framework for Node.js and the browser. Tagline: "Revolutionary: we thought it out before we pushed it out" 🤯

## Core Philosophy

Markout is inspired by OpenLaszlo's elegant design principles and aims to be a "modern-day OpenLaszlo" - bringing back thoughtful, stable framework design. Key principles:

- **HTML-first approach**: Build on HTML rather than trying to replace it with JavaScript
- **Simplicity over complexity**: No ceremonies, boilerplate, or framework-specific rituals
- **Polymorphic execution**: Server-side pre-rendering with client-side hydration by design
- **Stability**: Thoughtful design from the start, not constant breaking changes
- **Developer experience**: Make the simple things simple while keeping complex things possible

## Markout Syntax

Three simple additions to standard HTML:

- **Directives**: `<:import>`, `<:define>` for modularity and components
- **Logic values**: `:` prefixed attributes with dual syntax support
  - **Quoted**: `:count="${42}"` or `:message="Hello ${name}!"` (HTML-style with interpolation)
  - **Unquoted**: `:count=${42}` or `:config=${{ theme: "dark" }}` (direct JavaScript)
- **Reactive expressions**: `${...}` syntax for dynamic content in text and special tags

## Reserved Namespace and Naming Conventions

**Framework Reserved Identifiers**: Markout uses `$` as a reserved namespace to prevent conflicts with user code:

- **Runtime methods**: `$value()`, `$parent` - framework-provided scope access methods that users can access
- **Attribute prefixes**: `attr$`, `class$`, `style$`, `text$`, `event$` - internal runtime naming for reactive attributes
- **Declaration prohibition**: `$` is forbidden in user-declared identifiers (variables, functions, parameters) but users can access framework-provided `$` identifiers
- **Validation enforcement**: The validator prevents declaring new identifiers with `$` while allowing access to framework identifiers like `$parent` and `$value()`

**Dual Reactive Attribute Syntax**: Markout supports both quoted and unquoted expressions for maximum flexibility:

**Quoted Expressions** - HTML-native syntax with interpolation support:
- **Single expressions**: `:count="${42}"`, `:flag="${true}"` - preserve original JavaScript types
- **String interpolation**: `:title="Welcome ${user.name}, you have ${count} items"` - powerful template strings
- **Mixed interpolation**: `:message="User ${user.name} is ${user.age} years old"` - multiple variables in one string
- **Type behavior**: Single expressions preserve types, interpolated expressions become strings
- **Universal syntax highlighting**: Works perfectly in VS Code, Vim, Sublime, and any generic HTML highlighter
- **Copy-paste friendly**: Natural HTML-style syntax works seamlessly with existing HTML knowledge

**Unquoted Expressions** - Direct JavaScript syntax for complex expressions:
- **Clean syntax**: `:count=${42}`, `:flag=${true}` - no quote escaping needed
- **Mixed quotes**: `:message=${'String with "double" quotes'}` - use both quote types freely
- **Template literals**: `:greeting=${`Hello, ${name}! Welcome to "Markout".`}` - natural template literal support
- **Complex objects**: `:config=${{ theme: "dark", locale: "en-US" }}` - clean object notation
- **Type preservation**: All unquoted expressions preserve their original JavaScript types
- **Expression freedom**: Use any JavaScript expression syntax without HTML attribute limitations

**Syntax Comparison Examples**:
```html
<!-- Quoted syntax - good for simple expressions and string templates -->
<div :count="${42}" :greeting="Hello ${name}!">

<!-- Unquoted syntax - ideal for complex expressions with mixed quotes -->
<div :count=${42} :config=${{ theme: "dark", debug: true }}>
  
<!-- Both preserve types for single expressions -->
<span>${typeof count}</span> <!-- "number" in both cases -->

<!-- Interpolation vs template literals -->
<div :quoted="Count: ${count}">     <!-- becomes string -->
<div :unquoted=${`Count: ${count}`}> <!-- template literal (also string) -->
```

**Safe Markup Generation**: Framework uses triple-dash comments for conflict-free code generation:

- **Triple-dash format**: `<!---...-->` instead of standard `<!--...-->` HTML comments
- **Automatic removal**: These comments are removed from source code during processing
- **Text markers**: Dynamic text insertion uses `<!---t{id}_{index}-->...<!---/-->` pattern
- **Conflict prevention**: User HTML comments remain untouched while framework markers are safely processed
- **Clean separation**: Framework can inject markup freely without fear of clashing with user content

### Advanced Import Features (for reference docs)

**Fragment Root Attribute Inheritance**: Sophisticated attribute override system:

- Fragment root tag attributes are added to `<:import>` parent tag unless already present
- Enables default/override pattern: fragment defines defaults, parent can override
- Parent scope overrides work through lexical scoping - component code remains unchanged
- Works recursively across nested imports and sub-imports
- Provides intuitive component customization without prop drilling
- Refined through multiple PoC iterations for natural developer experience

**Automatic Dependency Resolution for Component Libraries**: Critical for ecosystem adoption

- Each fragment can import its own dependencies (base styles, other components)
- Import deduplication ensures dependencies load only once per page
- Enables zero-ceremony component libraries - just point to `.htm` files
- Promotes actual code reuse within teams/organizations (private component libraries)
- Design systems become simple HTML fragments instead of complex build processes
- Same pattern works for third-party libraries (Bootstrap) and internal company libraries
- Removes traditional barriers to component sharing between projects

**Advanced Data Handling with `<:data>`**: Sophisticated reactive data system

- REST endpoint integration: `<:data :aka="users" :src="/api/users" />`
- Local reactive data: `<:data :aka="config" :json="${{...}}" />`
- **GraphQL Integration**: Library-level GraphQL support implemented as reusable Markout components
  - Implementation: GraphQL clients built as fragment libraries using `<:data>` and JavaScript APIs
  - Query syntax: `<:import src="/lib/graphql/query.htm" :endpoint="/graphql" :query="${...}" />`
  - Reactive mutations: Component libraries that wrap GraphQL clients with reactive state management
  - Real-time subscriptions: WebSocket-based GraphQL subscriptions using standard `<:data>` patterns
  - Fragment composition: Reusable GraphQL fragments distributed as importable `.htm` files
  - **No Runtime Code**: Pure library implementation using existing `<:data>` capabilities and fragment imports
- **WebSocket Real-time Communication**: Library-level WebSocket support via fragment components
  - Implementation: WebSocket clients built as reusable fragment libraries using browser WebSocket API
  - Connection syntax: `<:import src="/lib/websocket/client.htm" :url="ws://..." />`
  - Message handling: Standard `<:data>` delegate methods (`:will-load`, `:did-load`) for connection lifecycle
  - Connection lifecycle: Implemented in fragment libraries using browser events and reactive state
  - Automatic reconnection: Retry logic implemented in reusable component libraries
  - Service-oriented patterns: WebSocket services exposable via standard Island service registration
  - **No Runtime Code**: Pure library implementation using existing reactive system and browser APIs
- **Explicit Property Access**: Access data via logic value properties (e.g., `users.json.list`, `config.json.setting`) - no magic property promotion
- **Reliable Data State**: `json` property always defined (at most empty object), `:foreach` handles undefined/null gracefully
- Data pipelines: Chain `<:data>` directives where each is a function of previous ones
- Automatic reactivity: Data updates flow through dependent components naturally
- Localization example: Dynamic menu that updates when language changes
- No separate data layers: Declare data needs directly in HTML
- Composable transformations: Build complex data flows without Redux-style complexity
- Async boundary management: Synchronous reactivity triggered by events, timers, and async data operations
- Extensible transport layer: Custom communication via `:will-` and `:did-` delegate methods
- **Business Logic Architecture**: `<:data>` is where business logic should live (validation, processing, domain rules)
- **Separation of Concerns**: Presentation logic scattered in visual objects, business logic centralized in data objects
- **Example Pattern**: `<:data :aka="userService" :validate="${(user) => ...}" />` for business rules, `:disabled="${!userService.validate(user)}"` for presentation
- **Universal Async Interface**: Unified patterns for WebSockets, GraphQL subscriptions, Workers, IndexedDB, WebRTC, Server-Sent Events
- **Library-First Architecture**: All advanced integrations implemented as importable fragment libraries, not runtime features
  - GraphQL clients: `<:import src="/lib/graphql/" />` - zero runtime overhead, pure component libraries
  - WebSocket handling: `<:import src="/lib/websockets/" />` - reusable connection components
  - Database integration: `<:import src="/lib/indexeddb/" />` - local storage patterns
  - **Ecosystem Benefits**: Community can build and share integration libraries without framework changes
  - **Zero Bloat**: Core runtime remains minimal, features added via selective library imports
  - **Company Libraries**: Internal teams can build standardized integration patterns as shared fragments
- **TypeScript Integration Timeline**: Basic TypeScript support planned for v0.4.0, full integration in v0.5.0
  - v0.4.0: Hybrid TypeScript/Acorn pipeline for type-safe expressions and basic IntelliSense
  - v0.5.0: Complete TypeScript Compiler API integration with advanced language features
  - Essential for GraphQL/WebSocket library ecosystem type safety and developer experience
- Future tooling needs: Dependency analysis, circular detection, type inference, GraphQL schema validation for VS Code extension

**Reactive Expressions in Special Tags**:

- `<style>` and `<title>` tags support reactive expressions `${...}`
- `<script>` tags are excluded to avoid conflicts with user JavaScript template literals
- Enables reactive CSS and dynamic titles
- Special handling required - cannot use standard HTML comment placemarkers in these contexts
- **CSS Reactivity Guidelines**: Use sparingly for theming and configuration that changes infrequently (e.g., at application launch)
- For dynamic styling, prefer `:class-` and `:style-` logic values on individual elements (browser-optimized)
- **Reactive CSS Benefits**: Removes CSS preprocessing need, enables switchable themes, adaptive styling, eliminates CSS vs JS variable barrier, single source of truth for components
- **Use Cases**: Themes, dark mode, responsive breakpoints, component parameterization, CSS custom property values, coordinated styling logic
- Performance consideration: Updates entire `<style>` tag content; browsers not optimized for frequent CSS rule changes

**Runtime Components Architecture**: Current implementation focus

- **Evolution**: Moving from compile-time macro expansion to runtime component instantiation
- **Benefits**: Enables dynamic component type selection, shared component behavior, unified replication system
- **Foundation**: Server-side DOM `<template>` implementation with nested light-weight document and clone method
- **No Shadow DOM**: Clean debugging and styling while maintaining encapsulation through scoping system
- **Component Flow**: Parse `<:define>` → Register template → Clone on instantiation → Activate reactive runtime
- **Replication Integration**: `<template :foreach>` uses same component instantiation system
- **Current Status**: Compiler generates BaseScopeProps structures that runtime instantiates as reactive scopes

**Current Implementation Status**: Fully functional server with SSR/CSR support

- **Server Infrastructure**: Complete Express.js server with middleware, rate limiting, compression, PM2 support
- **Reactive Runtime**: Full BaseContext/BaseScope/BaseValue system with DOM update batching
- **Compiler Pipeline**: Multi-phase compilation from HTML to reactive scope structures
- **Client-Server Hydration**: Server renders with reactive logic, client takes over seamlessly
- **Testing Coverage**: Comprehensive test suite covering runtime, compiler, integration, and server components

**Tooling Ecosystem**: Complete developer experience

- **CLI Tool**: Production-ready development and deployment solution
  - Development server with hot reload (`markout serve <docroot> --port 3000`)
  - Built-in Express.js server with compression, rate limiting, static file serving
  - Both SSR and CSR support with seamless client-side hydration
  - PM2 process management for production deployments
  - Graceful shutdown handling and error recovery
- **VS Code Extension**: Advanced development support (planned)
  - Syntax highlighting for `:` attributes and `${...}` expressions
  - IntelliSense for components, data references, and fragment imports
  - Dependency graph visualization for data pipelines and component relationships
  - Error detection for circular dependencies, type mismatches, undefined references
  - Live templates and snippets for common patterns
  - Component preview and parameter interface documentation
  - Fragment explorer for modular code organization

Example - complete working counter (showing both syntaxes):

```html
<!-- Quoted syntax -->
<html>
  <body>
    <button :count="${0}" :on-click="${() => count++}">
      Clicks: ${count}
    </button>
  </body>
</html>

<!-- Unquoted syntax (equivalent) -->
<html>
  <body>
    <button :count=${0} :on-click=${() => count++}>
      Clicks: ${count}
    </button>
  </body>
</html>

<!-- Mixed syntax showing advantages -->
<html>
  <body>
    <div :user=${{ name: "John", preferences: { theme: "dark" } }}
         :greeting="Welcome ${user.name}!"
         :debug=${process.env.NODE_ENV === "development"}>
      <span>${greeting}</span>
      <button :on-click=${() => console.log('User:', user.name)}>
        Click me
      </button>
    </div>
  </body>
</html>
```

## Technical Architecture

Built on TypeScript Node.js + Express.js foundation with complete full-stack reactive framework:

### **Reactive Runtime System**

- **Pull-based Reactive Engine**: Hierarchical scope system with proxy-based dependency tracking
- **Polymorphic DOM Support**: Same reactive logic works on browser DOM and server-side DOM for SSR/CSR
- **BaseContext**: Central coordinator with refresh cycles and batching system
- **BaseScope**: Hierarchical scopes with lexical variable lookup and proxy-based access
- **BaseValue**: Reactive values with expression evaluation, dependency tracking, and change propagation
- **WebScope**: Browser-specific scope implementation with DOM binding (attributes, classes, styles, text, events)

### **Advanced Reactive Capabilities (Already Built-In)**

Markout's reactive system already includes many features that other frameworks add later:

- **Computed Values**: `:count="${x + y}"` automatically recalculates when dependencies change with built-in caching
- **Effects**: Side effects using `:dummy="${(() => { /* effect code */ })(deps...)}"` pattern with automatic dependency tracking
- **Cross-Scope Reactivity**: Effects can depend on parent scope values via lexical scoping (e.g., `head.darkMode`)
- **Fine-Grained Updates**: Expression-level dependency tracking ensures only affected DOM nodes update
- **Isomorphic Execution**: Same reactive code runs on server (SSR) and client (hydration) without separate architectures

### **High-Performance DOM Update Batching**

- **Set-based Deduplication**: Automatically deduplicates multiple updates to same value using Set data structure
- **Automatic Batch Boundaries**: Batching integrated with reactive cycle boundaries - updates flushed when `refreshLevel` reaches 0
- **Transparent Operation**: Batching works seamlessly without requiring code changes
- **Cross-scope Batching**: Updates from multiple scopes batched in single context-wide pending Set
- **Propagation Integration**: Reactive propagation respects batching boundaries for optimal performance
- **Push and Pull Coverage**: Batches both `value.set()` updates and `context.refresh()`/`scope.updateValues()` calls
- **Nested Operation Support**: Handles nested refresh cycles while maintaining single batching context

### **Multi-Phase Compiler Pipeline**

Advanced compiler using Acorn for JavaScript AST analysis and escodegen for code generation:

- **Load Phase**: Parse HTML structure and extract scopes/values with location tracking
- **Validate Phase**: Enforce framework naming rules (no `$` in user identifiers) and syntax validation
- **Qualify Phase**: Auto-transform expressions with `this.` qualification for proper lexical scoping
- **Resolve Phase**: Build dependency graphs for reactive value updates and reference tracking
- **Comptime Phase**: Compile-time evaluation and optimization (future)
- **Treeshake Phase**: Remove unused values and optimize scope hierarchy
- **Generate Phase**: Output BaseScopeProps structure for runtime execution

### **HTML Processing Pipeline**

- **Sophisticated Parser**: Handles "augmented HTML" with `:` attributes and `${...}` expressions
- **Preprocessor**: Module loading, fragment imports, and dependency resolution
- **Server-side DOM**: Custom DOM implementation enabling server-side pre-rendering with reactive logic

## Project Structure

### **Source Code Architecture** (`src/`)

- **`src/index.ts`** - CLI entry point using Commander.js for `markout serve` command
- **`src/client.ts`** - Browser-side entry point for client-side reactive runtime
- **`src/constants.ts`** - Framework constants and global identifiers

### **Server Infrastructure** (`src/server/`)

- **`src/server/server.ts`** - Express.js server with compression, rate limiting, process management
- **`src/server/middleware.ts`** - Core Markout middleware handling SSR/CSR, compilation, and page serving
- **`src/server/logger.ts`** - Structured logging system with timestamps
- **`src/server/exit-hook.ts`** - Graceful shutdown handling (PM2 compatible)

### **Reactive Runtime System** (`src/runtime/`)

- **`src/runtime/base/base-context.ts`** - Central reactive coordinator with refresh cycles and batching
- **`src/runtime/base/base-scope.ts`** - Hierarchical scopes with proxy-based access and lexical lookup
- **`src/runtime/base/base-value.ts`** - Reactive values with expression evaluation and dependency tracking
- **`src/runtime/base/base-global.ts`** - Global scope with built-in functions (console, etc.)
- **`src/runtime/web/web-context.ts`** - Browser-specific context with DOM element mapping
- **`src/runtime/web/web-scope.ts`** - DOM-aware scope with attribute/style/text/event binding

### **Compiler Pipeline** (`src/compiler/`)

- **`src/compiler/compiler.ts`** - Main compiler orchestrating multi-phase compilation
- **`src/compiler/loader.ts`** - Load phase: HTML structure parsing and scope extraction
- **`src/compiler/validator.ts`** - Validate phase: Framework rules and syntax validation
- **`src/compiler/qualifier.ts`** - Qualify phase: Expression transformation for lexical scoping
- **`src/compiler/resolver.ts`** - Resolve phase: Dependency graph construction
- **`src/compiler/comptime.ts`** - Comptime phase: Compile-time evaluation (future)
- **`src/compiler/treeshaker.ts`** - Treeshake phase: Dead code elimination
- **`src/compiler/generator.ts`** - Generate phase: AST to BaseScopeProps conversion
- **`src/compiler/service.ts`** - Compiler service utilities

### **HTML Processing** (`src/html/`)

- **`src/html/parser.ts`** - HTML parser supporting `:` attributes and `${...}` expressions
- **`src/html/preprocessor.ts`** - Module loading, imports, and dependency resolution
- **`src/html/dom.ts`** - Cross-platform DOM abstraction (browser/server compatibility)
- **`src/html/server-dom.ts`** - Server-side DOM implementation for SSR

### **Build System**

- **`dist/`** - Compiled JavaScript output (esbuild)
- **`scripts/build-server.mjs`** - Server build configuration (Node.js target)
- **`scripts/build-client.mjs`** - Client build configuration (browser target, minified)

### **Comprehensive Testing** (`tests/`)

- **`tests/runtime/`** - Runtime system tests (BaseContext, BaseScope, BaseValue, batching)
- **`tests/compiler/`** - Compiler phase tests with input/output fixtures
- **`tests/html/`** - HTML parser and preprocessor tests
- **`tests/server/`** - Server integration tests
- **`tests/integration/`** - Full compiler-runtime integration tests
- Testing with Vitest, Happy DOM, and comprehensive coverage reporting

## Available Scripts

### **Development**

- `npm run dev` - Development server with hot reload using nodemon and ts-node
- `npm run build` - Build both server and client using esbuild (fast TypeScript compilation)
- `npm run watch` - Watch TypeScript files and rebuild continuously
- `npm run clean` - Clean the dist directory

### **Production Server Management**

- `npm start` - Production server (single Node.js process)
- `npm run start:prod` - Production server with PM2 cluster mode
- `npm run start:dev` - Development server with PM2
- `npm run stop` - Stop PM2 processes
- `npm run restart` - Restart PM2 processes
- `npm run reload` - Graceful reload PM2 processes (zero downtime)
- `npm run delete` - Delete PM2 processes
- `npm run logs` - View PM2 logs
- `npm run monit` - Open PM2 monitoring dashboard

### **Testing & Quality**

- `npm test` - Run tests once (Vitest)
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report (V8 coverage)
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check if code is formatted correctly

### **CLI Usage**

```bash
# Serve a Markout project
node dist/index.js serve <docroot> [--port 3000]

# Example: serve current directory on port 8080
node dist/index.js serve . --port 8080
```

## Development Philosophy

- **Stability over trends**: Focus on getting fundamentals right rather than chasing latest patterns
- **Developer experience first**: Natural syntax that doesn't require learning framework-specific ceremonies
- **Lexical scoping**: Variables work as developers expect - compiler auto-transforms for reactive system
- **Ecosystem compatibility**: Bootstrap wrapper for familiar components, Web Components support (Shoelace, etc.)
- **Thoughtful evolution**: Changes driven by real needs, not marketing pressure

## Testing Framework

- **Vitest** - Fast unit test framework with TypeScript support
- **Supertest** - HTTP assertion library for API testing
- **happy-dom** - Fast DOM environment for client-side testing
- **Coverage reports** - V8 coverage provider with HTML/JSON output
- Test files located in `tests/` directory
- Automatic environment selection (Node.js vs happy-dom based on file naming)

## Testing Environment Selection

All tests currently run in **Node.js** environment for maximum Node.js 18+ compatibility:

- Server-side testing with Node.js environment provides optimal performance and compatibility
- Happy DOM is available in `tests/dom-util.ts` for DOM testing when needed via `runPage()` function
- Future DOM-specific tests can be added with `.dom.test.ts` naming if needed

## Example Components

- `src/utils.ts` - Basic utility functions (math, string operations)
- `src/dom-utils.ts` - DOM manipulation utilities for client-side code
- `src/counter.ts` - Example client-side component with DOM interaction
- `src/index.ts` - Main Express server application

## Test Examples

- `tests/utils.test.ts` - Unit tests for utility functions
- `tests/api.test.ts` - Integration tests for API endpoints
- `tests/rate-limit.test.ts` - Rate limiting functionality tests
- `tests/dom-utils.dom.test.ts` - DOM utility function tests
- `tests/counter.dom.test.ts` - Client-side component tests

## CI/CD & DevOps Infrastructure

### **GitHub Actions Workflows** (`.github/workflows/`)

- **Main CI Pipeline** (`ci.yml`) - Multi-Node.js version testing (18.x, 20.x, 22.x) with build, test, coverage, security audit, and code quality
- **Cross-Platform Build** (`cross-platform.yml`) - Ensures compatibility across Ubuntu, Windows, and macOS
- **Security Analysis** (`codeql.yml`) - GitHub CodeQL semantic analysis with weekly scheduled scans
- **Release Automation** (`release.yml`) - Automated releases and npm publishing (when ready)
- **Dependency Management** (`dependabot.yml`) - Automated weekly dependency updates with grouped PRs

### **Code Quality & Security Integration**

- **ESLint/Prettier** - Code quality and formatting with TypeScript/JavaScript rules
- **Codecov** - Coverage tracking and reporting with detailed metrics
- **Snyk** - Vulnerability scanning for dependencies and security issues
- **Dependency Review** - Automated security review for new dependencies in PRs

### **Cross-Platform Compatibility**

- **Line Ending Normalization** - Comprehensive solution for Windows/Unix compatibility issues
  - `normalizeLineEndings()` and `normalizeTextForComparison()` utilities in `tests/util.ts`
  - `.gitattributes` configuration enforcing LF line endings for all text files
  - GitHub Actions configured with `autocrlf: false` for consistent checkout behavior
  - All compiler and preprocessor tests use cross-platform text comparison functions
- **Test Reliability** - 178+ tests passing consistently across all platforms
- **Repository Configuration** - Proper Git attributes for consistent development experience

## Production Features

- **PM2 Process Manager** - Cluster mode, zero-downtime deployments, crash recovery
- **Health Monitoring** - HTTP endpoint health checks and automatic restarts
- **Load Balancing** - Built-in load balancer across CPU cores
- **Logging** - Centralized logging with log rotation and monitoring
- **Memory Management** - Automatic restart on memory leaks (1GB limit)

## Security Features

- **Rate Limiting** - express-rate-limit for API protection and DoS prevention
- **Request throttling** - Different limits for general and sensitive endpoints
- **Standard headers** - Rate limit information in response headers
- **Automated Security Scanning** - CodeQL, Snyk, and npm audit in CI pipeline
- **Dependency Security Review** - Automated review of new dependencies for vulnerabilities

## Testing Framework

- **Vitest** - Fast unit test framework with TypeScript support
- **Supertest** - HTTP assertion library for API testing
- **Happy DOM** - Fast, lightweight DOM environment for client-side testing with full Node.js compatibility
- **Coverage reports** - V8 coverage provider with HTML/JSON/LCOV output
- **Cross-platform utilities** - Line ending normalization for reliable test comparisons
- Test files located in `tests/` directory with comprehensive fixture-based testing

### **Testing Environment Selection**

All tests currently run in **Node.js** environment for maximum Node.js 18+ compatibility:

- Server-side testing with Node.js environment provides optimal performance and compatibility
- Happy DOM is available in `tests/dom-util.ts` for DOM testing when needed via `runPage()` function
- Happy DOM provides better compatibility across all Node.js versions compared to JSDOM
- Future DOM-specific tests can be added with `.dom.test.ts` naming if needed

### **Test Structure**

- **`tests/runtime/`** - Reactive system tests (context, scope, value, batching)
- **`tests/compiler/`** - Multi-phase compiler tests with fixture-based input/output validation
- **`tests/html/`** - HTML parser and preprocessor tests
- **`tests/server/`** - Express.js server integration tests
- **`tests/integration/`** - Full compiler-runtime integration tests
- **`tests/line-endings.test.ts`** - Cross-platform compatibility validation

## Development Guidelines

- **NEVER modify source code directly** - Do not make changes to files in `src/` directory. Always discuss architecture changes with the maintainer first
- **Use TypeScript** for all source code with strict type checking
- **Follow Express.js best practices** for server architecture
- **Build and test thoroughly** - stability is a core value (178+ tests)
- **Write tests for new features** using Vitest with fixture-based testing patterns
- **Use Prettier** for consistent code formatting across the team
- **Focus on developer experience** and intuitive API design
- **Consider long-term maintenance** and stability in all architectural decisions
- **Ensure cross-platform compatibility** - test on Windows, macOS, and Linux
- **Maintain comprehensive CI/CD** - all changes must pass quality gates
- **Document breaking changes** - framework stability is paramount

## CLI and Tooling

**Markout CLI**: Complete development and deployment solution

- **Development server**: `markout serve` with hot reload, live compilation, and error reporting
- **Production deployment**: PM2 integration, clustering, health checks, and monitoring
- **Project scaffolding**: Templates for Bootstrap, Shoelace, minimal, and component library projects
- **Build tools**: Static site generation, PWA builds, pre-rendering, and bundle analysis
- **Development utilities**: Syntax validation, code formatting, and documentation generation

**VS Code Extension** (planned): Advanced development support with syntax highlighting, IntelliSense, dependency visualization, and component preview.

## Ecosystem Integration

**Ecosystem Integration**: Markout works seamlessly with existing web technologies:

- **Bootstrap Integration**: Wrap verbose Bootstrap components into clean, reactive Markout components
- **Web Components**: Shoelace and other Web Component libraries work natively with reactive logic values
- **Component Libraries**: Build reusable component libraries using `.htm` fragments with automatic dependency resolution
- **Legacy Code**: Existing HTML/CSS/JS can be progressively enhanced with Markout features

**Component Library Patterns**:

- Fragment-based components with `<:define>` for reusable UI elements
- Automatic dependency resolution eliminates manual import management
- CSS encapsulation through fragment imports without Shadow DOM complexity
- Cross-project component sharing through standardized `.htm` fragment files

**Two-Tier Component Architecture** (Planned for 1.x):

Markout will support a elegant dual-component system addressing different isolation needs:

- **Islands = Web Components** (Heavy Isolation)
  - Purpose: Independent, reusable widgets requiring full encapsulation
  - Implementation: `<:island src="/widgets/counter.htm">` creates Web Component with Shadow DOM
  - Isolation: Complete CSS/DOM boundaries, separate Markout contexts
  - Communication: Service-oriented via `<:data :src="@serviceName">` and standard DOM events/attributes
  - Use Cases: Third-party widgets, micro-frontends, cross-team components, legacy integration
  - Mental Model: "Mini applications with full isolation"

- **Components = Markup Scopes** (Light Composition)  
  - Purpose: Logical organization within islands or main applications
  - Implementation: Existing `<:import>` and `<:define>` directives
  - Isolation: Lexical scoping for reactive values, shared styling context
  - Communication: Direct scope access, shared reactive context
  - Use Cases: UI patterns, layout components, data presentation within apps
  - Mental Model: "Template fragments with reactive logic"

**Service-Oriented Island Communication**:

Islands can expose services through named registration, enabling reactive inter-island communication:

```html
<!-- Service island -->
<:island src="/services/cart.htm" name="cartService">
  <:data :aka="cartData" :src="/api/cart/local" />
  <:data :aka="cartService" :json="${{
    async addItem(item) { /* async operations */ },
    get items() { return cartData.json.items; },
    get total() { return cartData.json.total; }
  }}" />
</:island>

<!-- Consumer island -->
<:island src="/widgets/product-list.htm">
  <:data :aka="cart" :src="@cartService" />
  <button :on-click="${() => cart.json.addItem(product)}">
    Add to Cart (${cart.json.count})
  </button>
</:island>
```

This approach provides optimal performance (isolation only where needed) while maintaining clear conceptual boundaries between "what needs isolation" (islands) vs "what can share context" (components). Islands can contain regular Markout components internally and communicate through reactive services, creating a powerful composability system built on web standards and async-capable data flow.

Project is enterprise-ready with comprehensive testing (178+ tests), security scanning, cross-platform compatibility, and production-grade process management.
