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
- [ ] Publish to npm as `markout` (currently requires manual build)
- [ ] Set up automated releases via GitHub Actions
- [ ] Create installation and quick start documentation

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
**Theme: Advanced Features**

**New Features:**
- [ ] Complete `<:data>` directive (REST endpoints, caching, error handling)
- [ ] Web Components integration and interoperability
- [ ] Advanced component patterns (higher-order components, mixins)
- [ ] Static site generation capabilities

**Improvements:**
- [ ] Production deployment guides and best practices
- [ ] Security hardening and vulnerability assessment
- [ ] Bundle size optimization and tree shaking
- [ ] Advanced testing utilities and patterns

**Breaking Changes Expected:** Minor - focused on API consistency

---

### Milestone: v0.5.0 (Beta)
**Theme: API Stabilization**

**Goals:**
- [ ] Feature freeze - no new major features
- [ ] API stabilization - minimize breaking changes
- [ ] Comprehensive testing of all feature combinations
- [ ] Production readiness assessment

**Focus Areas:**
- [ ] API consistency review and final adjustments
- [ ] Performance benchmarking against other frameworks
- [ ] Security audit and penetration testing
- [ ] Documentation completeness and accuracy
- [ ] Community feedback integration

**Breaking Changes Expected:** Final API cleanup only

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

## Post-1.0 Vision

### Future Major Versions (v2.0+)
- **Server Components**: React Server Components-style architecture
- **Edge Computing**: Cloudflare Workers, Deno Deploy optimization
- **Advanced Reactivity**: Fine-grained reactivity, computed values, effects
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