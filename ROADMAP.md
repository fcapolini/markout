# Markout Development Roadmap

## Current Status: Alpha (v0.1.0)

Markout is currently in **alpha development**. The core reactive system is functional and many features are working, but the framework is not yet feature-complete and APIs may change.

## Feature Status Overview

### ✅ Working Features (Alpha Ready)

- **Reactive Runtime System**: Full BaseContext/BaseScope/BaseValue system with DOM update batching
- **Logic Values**: `:` prefixed attributes (`:count`, `:on-click`, `:class-`, `:style-`, `:watch-`)
- **Reactive Expressions**: `${...}` syntax for dynamic content in HTML and attributes
- **Looping**: `<template :foreach>` and `:foreach` attribute for array iteration
- **Components**: `<:define>` directive with slot support for reusable components
- **Fragments**: `<:import>` system for modular HTML organization
- **Server Infrastructure**: Complete Express.js server with middleware, rate limiting, compression
- **SSR/CSR**: Server-side rendering with seamless client-side hydration
- **Development Tools**: CLI with `markout serve`, hot reload, PM2 process management
- **Build System**: TypeScript compilation, client/server bundles via esbuild
- **Testing**: Comprehensive test suite (178+ tests) covering runtime, compiler, and integration

### 🚧 In Development

- **Runtime Component System**: Moving from compile-time to runtime component instantiation
- **Advanced Fragment Features**: Dependency resolution and attribute inheritance
- **Cross-Platform Compatibility**: Windows/macOS/Linux line ending normalization

### ❌ Missing Features (Blocking Beta)

- **Conditionals**: `<template :if>`, `:else`, `:elseif` directives
- **Data Services**: `<:data>` directive for REST endpoints and reactive data
- **Advanced Component Features**: Dynamic component type selection, shared behavior
- **VS Code Extension**: Syntax highlighting, IntelliSense, debugging support

## Development Milestones

### Milestone: v0.2.0 (Alpha)
**Theme: Complete Core Directives**

**Distribution:**
- [x] Publish to npm as `@markout-js/cli` ✅ **DONE in v0.1.0**
- [ ] Set up automated releases via GitHub Actions
- [x] Create installation and quick start documentation ✅ **DONE**

**New Features:**
- [ ] Implement conditional rendering (`<template :if>`, `:else`, `:elseif`)
- [ ] Complete runtime component instantiation system
- [ ] Enhance fragment import system with dependency resolution
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
**Theme: Advanced Data & Library Foundations**

**New Features:**
- [ ] Complete `<:data>` directive (REST endpoints, caching, error handling, delegate methods)
- [ ] **TypeScript Reactive Expressions**: Initial TypeScript support in reactive expressions
  - [ ] Hybrid TypeScript/Acorn compiler pipeline for type-safe expressions
  - [ ] Basic type checking for reactive values and component properties
  - [ ] TypeScript-aware VS Code extension with IntelliSense
  - [ ] Type-safe data access patterns: `<:data :aka="users" :type="User[]" />`
  - [ ] Foundation for advanced library ecosystem type safety
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
- [ ] GraphQL schema validation and type safety tooling
- [ ] Library documentation and usage patterns
- [ ] Advanced component patterns (higher-order components, mixins)

**Breaking Changes Expected:** Minor - focused on API consistency

---

### Milestone: v0.5.0 (Beta)
**Theme: Islands Architecture & Full TypeScript Integration**

**New Features:**
- [ ] **Two-tier Island/Component Architecture**: Complete implementation
  - [ ] `<:island src="/widgets/counter.htm">` with Shadow DOM isolation
  - [ ] Service-oriented communication via `<:data :src="@serviceName">` for reactive inter-island data flow
  - [ ] Async-capable services handle complex operations (local DB, APIs) while maintaining reactive interfaces
  - [ ] Clear mental model: "Heavy isolation" vs "Light composition" with reactive service communication
- [ ] **Enhanced TypeScript Support**: Full TypeScript integration for reactive expressions
  - [ ] Replace Acorn with TypeScript Compiler API for complete type safety
  - [ ] Advanced language features: optional chaining, nullish coalescing, template literal types
  - [ ] Type-safe component interfaces and data contracts
  - [ ] Rich VS Code integration with type-aware IntelliSense and error detection
  - [ ] Type-safe library ecosystem foundation for GraphQL/WebSocket integrations
- [ ] **Mature Library Ecosystem**: Production-ready integration libraries
  - [ ] Complete GraphQL library suite (queries, mutations, subscriptions, fragments)
  - [ ] Full WebSocket library ecosystem (chat, collaboration, real-time data)
  - [ ] Universal async libraries (Server-Sent Events, IndexedDB, Web Workers, WebRTC)
  - [ ] Community contribution guidelines and library standards
- [ ] **Advanced Tooling**: Enhanced VS Code extension with component preview, dependency visualization, and TypeScript diagnostics

**Improvements:**
- [ ] Performance optimizations for Islands isolation
- [ ] Library ecosystem documentation and examples
- [ ] Advanced debugging tools for service-oriented communication

**Breaking Changes Expected:** Minor - Islands architecture addition only

---

### Milestone: v0.6.0 - v0.8.0 (Beta Iterations)
**Theme: Production Hardening**

**Focus Areas:**
- [ ] Real-world application testing and feedback
- [ ] Performance optimization and memory leak detection
- [ ] Cross-browser compatibility testing
- [ ] Accessibility (a11y) compliance and testing
- [ ] Internationalization (i18n) support
- [ ] Advanced deployment scenarios (CDN, microservices, etc.)

**Breaking Changes Expected:** None - bug fixes and performance improvements only

---

### Milestone: v0.9.0 (Release Candidate)
**Theme: Ecosystem Maturity**

**New Features:**
- [ ] VS Code extension with full IntelliSense support
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
**Theme: Advanced Language Features**

**Major Features:**
- [ ] **Optional Dependencies**: `?` syntax for graceful handling of missing scope variables
  - Syntax: `:x=${head.darkMode?}` returns `undefined` instead of compilation error
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

### Future Major Versions (v2.0+)
- **Advanced TypeScript Features**: Enhanced type system integration beyond v0.5.0 foundation
  - Advanced type inference and flow analysis for reactive expressions
  - Type-safe component composition with strict interface contracts
  - Generic component types and advanced type constraints
  - Integration with TypeScript language server for real-time diagnostics
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