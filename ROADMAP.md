# Markout Development Roadmap

## Current Status: Alpha (v0.1.0)

Markout is currently in **alpha development**. The core reactive system is functional and many features are working, but the framework is not yet feature-complete and APIs may change.

## Feature Status Overview

### ✅ Working Features (Alpha Ready)

- **Reactive Runtime System**: Full BaseContext/BaseScope/BaseValue system with DOM update batching
- **Logic Values**: `:` prefixed attributes (`:count`, `:on-click`, `:class-`, `:style-`, `:watch-`)
- **Reactive Expressions**: `${...}` syntax for dynamic content in HTML and attributes
- **Fragments**: `<:import>` system for modular HTML organization
- **Advanced Fragment Features**: Dependency resolution and attribute inheritance
- **Cross-Platform Compatibility**: Windows/macOS/Linux line ending normalization
- **Server Infrastructure**: Complete Express.js server with middleware, rate limiting, compression
- **SSR/CSR**: Server-side rendering with seamless client-side hydration
- **Development Tools**: CLI with `markout serve`, PM2 process management
- **Build System**: TypeScript compilation, client/server bundles via esbuild
- **Testing**: Comprehensive test suite (178+ tests) covering runtime, compiler, and integration

### 🚧 In Development

- **Conditionals**: `<template :if>`, `:else`, `:elseif` directives
- **Looping**: `<template :foreach>` and `:foreach` attribute for array iteration
- **Runtime Component System**: Moving from compile-time to runtime component instantiation

### ❌ Missing Features (Blocking Beta)

- **Components**: `<:define>` directive with slot support for reusable components
- **Data Services**: `<:data>` directive for REST endpoints and reactive data
- **Development Tools**: hot reload in development server
- **Advanced Component Features**: Dynamic component type selection, shared behavior

## Development Milestones

### Milestone: v0.2.0 (Alpha)
**Theme: Complete Core Directives**

**Distribution:**
- [x] Publish to npm as `@markout-js/cli`
- [x] Create installation and quick start documentation
- [x] Enhance fragment import system with dependency resolution
- [ ] Set up automated releases via GitHub Actions

**New Features:**
- [ ] Implement conditional rendering (`<template :if>`, `:else`, `:elseif`)
- [ ] Complete runtime component instantiation system
- [ ] Add component parameter validation and error handling

**Improvements:**
- [ ] Stabilize compiler API boundaries
- [ ] Improve error messages and debugging experience
- [ ] Add more comprehensive examples and documentation
- [ ] Performance optimizations for reactive system

**Breaking Changes Expected:** Yes - API refinements based on usage feedback

---

### Milestone: v0.3.0 (Alpha)
**Theme: Developer Experience**

**New Features:**
- [ ] Basic `<:data>` directive implementation (local data only)
- [ ] Component lifecycle hooks (`:will-mount`, `:did-mount`, etc.)
- [ ] Enhanced debugging capabilities and error reporting
- [ ] Template validation and compile-time error detection

**Improvements:**
- [ ] Better CLI error messages and help system
- [ ] Hot reload improvements and error recovery
- [ ] Documentation website with interactive examples
- [ ] Performance profiling and optimization tools

**Breaking Changes Expected:** Minor - mostly additive features

---

### Milestone: v0.4.0 (Alpha)
**Theme: Advanced Data & Fragment Library Foundations**

**New Features:**
- [ ] Complete `<:data>` directive (REST endpoints, caching, error handling, delegate methods)
- [ ] **Fragment Library Ecosystem**: NPM package publishing strategy for official @markout-js/* libraries
  - [ ] Enhanced preprocessor with node_modules resolution and security validation
  - [ ] Polymorphic fragment implementations (SSR + CSR compatible patterns)
  - [ ] Static file serving for client-side JavaScript modules via Express.js
  - [ ] Package discovery and validation system with comprehensive error reporting
- [ ] **Reference Integration Libraries**: Community-ready library examples
  - [ ] GraphQL integration library: `<:import src="/lib/graphql/query.htm" />` with reactive state management
  - [ ] WebSocket integration library: `<:import src="/lib/websocket/client.htm" />` with lifecycle management
  - [ ] Server-Sent Events, IndexedDB examples as proof-of-concept libraries
  - [ ] **Zero Runtime Code**: Pure library implementation using existing `<:data>` and browser APIs
  - [ ] **Library-First Architecture**: All integrations as importable components, zero framework bloat
- [ ] Web Components integration and interoperability
- [ ] Static site generation capabilities

**Improvements:**
- [ ] Production deployment guides and best practices
- [ ] Security hardening and vulnerability assessment
- [ ] Bundle size optimization and tree shaking
- [ ] Advanced testing utilities and patterns
### Milestone: v0.3.0 (Alpha)
**Theme: Library Ecosystem Foundation**

**Distribution & Infrastructure:**
- [ ] **Node.js Package Resolution**: Enhanced preprocessor for fragment imports from node_modules
  - [ ] Support `@markout-js/*` official package imports
  - [ ] Security validation for allowed package patterns  
  - [ ] Automatic dependency resolution from npm packages
  - [ ] Cross-platform compatibility testing
- [ ] **Official Library Publishing**: First wave of @markout-js packages
  - [ ] `@markout-js/ui-bootstrap` - Bootstrap integration components
  - [ ] `@markout-js/data-validation` - Valibot validation library
  - [ ] `@markout-js/ui-shoelace` - Shoelace Web Components integration
  - [ ] Publishing workflow and automated releases

**Advanced Fragment Features:**
- [ ] Fragment parameter validation and type checking
- [ ] Enhanced error reporting for fragment imports
- [ ] Library documentation and usage patterns
- [ ] Advanced component patterns (higher-order components, mixins)

**SSR & Module Integration:**
- [ ] Polymorphic fragment implementations (SSR + CSR compatible)
- [ ] Static file serving for custom JS modules
- [ ] Progressive enhancement patterns for client-side modules
- [ ] SSR compatibility guidelines for library authors

**Breaking Changes Expected:** Minor - focused on API consistency

---

### Milestone: v0.4.0 (Alpha)
**Theme: Advanced Integrations**

**New Features:**
- [ ] **Mature Library Ecosystem**: Production-ready integration libraries
  - [ ] Complete GraphQL library suite (queries, mutations, subscriptions, fragments)
  - [ ] Full WebSocket library ecosystem (chat, collaboration, real-time data)
  - [ ] Universal async libraries (Server-Sent Events, IndexedDB, Web Workers, WebRTC)
  - [ ] Community contribution guidelines and library standards
- [ ] **Enhanced SSR Capabilities**: Optional advanced server-side rendering
  - [ ] Evaluate Happy DOM for full browser environment SSR
  - [ ] Custom module resolution for server-side execution
  - [ ] Performance analysis and optimization strategies

**Breaking Changes Expected:** Minor - focused on ecosystem expansion

---

### Milestone: v0.5.0 (Beta)
**Theme: Production Readiness**

**New Features:**
- [ ] **Performance & Reliability**: Production-grade optimizations
  - [ ] Memory leak detection and prevention
  - [ ] Performance profiling and optimization
  - [ ] Cross-browser compatibility validation
  - [ ] Load testing and stress testing
- [ ] **Enterprise Features**: Advanced production capabilities
  - [ ] Component library versioning and compatibility
  - [ ] Advanced caching strategies
  - [ ] Security auditing and compliance

**Improvements:**
- [ ] Library ecosystem documentation and examples
- [ ] Advanced debugging and error reporting
- [ ] Production deployment best practices
- [ ] Community package validation and certification

**Breaking Changes Expected:** Minor - focused on API consistency and performance

---

### Milestone: v0.6.0 - v0.8.0 (Beta Iterations)
**Theme: Ecosystem Maturation & Standards**

**Focus Areas:**
- [ ] Real-world application testing and feedback
- [ ] Accessibility (a11y) compliance and testing
- [ ] Internationalization (i18n) support
- [ ] Advanced deployment scenarios (CDN, microservices, etc.)
- [ ] Component library ecosystem growth and standardization
- [ ] Documentation and tutorial refinement
- [ ] Third-party integration examples and patterns

**Library Ecosystem Growth:**
- [ ] Community package showcase and discovery
- [ ] Enterprise library patterns and best practices
- [ ] Integration with popular development tools
- [ ] Performance benchmarking across library combinations

**Breaking Changes Expected:** None - bug fixes and ecosystem improvements only

---

### Milestone: v0.9.0 (Release Candidate)
**Theme: Ecosystem Maturity**

**New Features:**
- [ ] Component library ecosystem (Bootstrap wrappers, UI kits)
- [ ] Advanced CLI features (project scaffolding, deployment tools)
- [ ] Integration with popular tools (Vite, Webpack, Storybook)

**Quality Assurance:**
- [ ] Comprehensive end-to-end testing
- [ ] Load testing and performance validation
- [ ] Security compliance and audit
- [ ] Documentation review and tutorial creation

**Breaking Changes Expected:** None - stability commitment begins

---

### Milestone: v1.0.0 (Stable Release)
**Theme: Stability Promise**

**Commitments:**
- [ ] **No Breaking Changes**: Semantic versioning with backward compatibility
- [ ] **Long-Term Support**: Security updates and bug fixes for extended period  
- [ ] **Ecosystem Stability**: Component libraries and tools work reliably
- [ ] **Production Ready**: Used successfully in production applications

**Launch Features:**
- [ ] Complete documentation website with tutorials
- [ ] Community support channels and contribution guidelines  
- [ ] Migration guides from other frameworks
- [ ] Performance comparisons and benchmarks
- [ ] Enterprise support and consulting services

---

### Milestone: v1.x (Feature Extensions)
**Theme: Advanced Ecosystem & VS Code Integration**

**Major Features:**
- [ ] **VS Code Extension**: Language Server Protocol implementation
  - [ ] Syntax highlighting for `:` attributes and `${...}` expressions
  - [ ] Import completion and IntelliSense for fragment libraries
  - [ ] Package discovery with quick fixes for missing imports
  - [ ] Component parameter completion and validation
  - [ ] Error detection with actionable suggestions
  - [ ] Fragment explorer and dependency visualization
  - See: `docs/specifications/vscode-extension-integration.md`

- [ ] **Fragment Library Ecosystem**: Complete NPM package strategy
  - [ ] Official @markout-js/* component libraries (validation, bootstrap, forms, charts)
  - [ ] Community package template and publishing guidelines
  - [ ] Package discovery and validation system
  - [ ] Library performance benchmarking and compatibility testing
  - See: `docs/specifications/fragment-library-publishing.md`

- [ ] **Optional Dependencies**: `?` syntax for graceful handling of missing scope variables
  - Syntax: `:x="${head.darkMode?}"` returns `undefined` instead of compilation error
  - Enables progressive enhancement and conditional features
  - Full backward compatibility with existing code
  - See: `docs/specifications/optional-dependencies.md`

- [ ] **Advanced Component Patterns**: Enhanced composition and reusability
  - [ ] Higher-order components and component factories
  - [ ] Mixins and component inheritance patterns
  - [ ] Dynamic component type selection at runtime
  - [ ] Component lifecycle optimization and caching

- [ ] **Enterprise Features**: Production-scale capabilities
  - [ ] Advanced monitoring and analytics integration
  - [ ] Performance profiling and optimization tools
  - [ ] Security compliance and audit capabilities
  - [ ] Deployment automation and CI/CD integration

## Post-1.0 Vision

### Future Major Versions (v2.x)
- **VS Code Extension & TypeScript Integration**: Advanced developer tooling and type safety
  - **VS Code Extension** (v2.0): Full-featured development environment
    - Syntax highlighting for `:` attributes and `${...}` expressions
    - IntelliSense for components, data references, and fragment imports
    - Dependency graph visualization for data pipelines and component relationships
    - Error detection for circular dependencies, type mismatches, undefined references
    - Live templates and snippets for common patterns
    - Component preview and parameter interface documentation
    - Fragment explorer for modular code organization
    - **Breaking Changes**: None - pure tooling addition
  - **Initial TypeScript Support** (v2.1): Hybrid TypeScript/Acorn compiler pipeline for type-safe expressions
    - Basic type checking for reactive values and component properties
    - TypeScript-aware VS Code extension with IntelliSense
    - Type-safe data access patterns: `<:data :aka="users" :type="User[]" />`
    - Foundation for library ecosystem type safety
    - **Breaking Changes**: None - TypeScript is optional, JavaScript expressions continue to work unchanged
  - **Full TypeScript Integration** (v2.2): Replace Acorn with TypeScript Compiler API
    - Advanced language features: optional chaining, nullish coalescing, template literal types
    - Type-safe component interfaces and data contracts
    - Rich VS Code integration with type-aware IntelliSense and error detection
    - Type-safe library ecosystem foundation for GraphQL/WebSocket integrations
    - **Breaking Changes**: None - JavaScript expressions remain fully supported
  - **Advanced TypeScript Features** (v2.3+): Enhanced type system integration
    - Advanced type inference and flow analysis for reactive expressions
    - Type-safe component composition with strict interface contracts
    - Generic component types and advanced type constraints
    - Integration with TypeScript language server for real-time diagnostics
    - **Breaking Changes**: None - TypeScript features are opt-in enhancements
- **Islands Architecture** (v3.x): Advanced component isolation and micro-frontend capabilities
  - **Two-tier Island/Component Architecture**: Complete implementation
    - `<:island src="/widgets/counter.htm">` with Shadow DOM isolation
    - Service-oriented communication via `<:data :src="@serviceName">` for reactive inter-island data flow
    - Async-capable services handle complex operations (local DB, APIs) while maintaining reactive interfaces
    - Clear mental model: "Heavy isolation" vs "Light composition" with reactive service communication
    - **Breaking Changes**: None - Islands are additive to existing component system
  - **Advanced Island Features**: Enterprise-grade isolation patterns
    - Cross-island state synchronization and event coordination
    - Island lifecycle management and lazy loading
    - Performance optimizations for Islands isolation
    - Advanced debugging tools for service-oriented communication
    - Micro-frontend integration patterns and deployment strategies
    - **Breaking Changes**: None - existing components and fragments continue to work unchanged
- **Edge Computing**: Cloudflare Workers, Deno Deploy optimization
- **Advanced Reactivity**: Object property tracking, array item reactivity
- **Mobile Integration**: React Native-style mobile app development
- **AI/ML Integration**: Template generation, accessibility enhancement

### Ecosystem Growth
- **Component Marketplace**: Community-driven component sharing
- **Design System Tools**: Visual component builders and design tokens
- **Enterprise Features**: Advanced security, monitoring, analytics
- **Framework Integrations**: Next.js-style meta-framework built on Markout

## Contributing

This roadmap is living document. Community feedback and contributions help shape priorities:

- **Feature Requests**: Open issues for missing functionality
- **Bug Reports**: Help identify stability and compatibility issues  
- **Documentation**: Improve examples, tutorials, and API docs
- **Testing**: Add test cases for edge cases and real-world scenarios
- **Performance**: Profile and optimize critical code paths

## Philosophy

Markout's development follows these principles:

- **Stability Over Speed**: Get it right before rushing to market
- **Developer Experience First**: Make common tasks simple and intuitive
- **HTML-Centric Design**: Build on web standards rather than replacing them
- **Thoughtful Evolution**: Changes driven by real needs, not trends
- **Community Feedback**: Listen to users but maintain coherent vision

---

*Last Updated: October 2025*