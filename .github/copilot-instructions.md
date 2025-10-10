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
- **Logic values**: `:` prefixed attributes (`:count`, `:on-click`) for reactive state
- **Reactive expressions**: `${...}` syntax for dynamic content

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
- Local reactive data: `<:data :aka="config" :json=${{...}} />`
- Data pipelines: Chain `<:data>` directives where each is a function of previous ones
- Automatic reactivity: Data updates flow through dependent components naturally
- Localization example: Dynamic menu that updates when language changes
- No separate data layers: Declare data needs directly in HTML
- Composable transformations: Build complex data flows without Redux-style complexity
- Async boundary management: Synchronous reactivity triggered by async events and data
- Extensible transport layer: Custom communication via `:will-` and `:did-` delegate methods
- Universal async interface: WebSockets, Workers, IndexedDB, WebRTC, Server-Sent Events
- Future tooling needs: Dependency analysis, circular detection, type inference for VS Code extension

**Reactive Expressions in Special Tags**: 
- `<style>`, `<title>`, and `<script>` tags support reactive expressions `${...}`
- Enables reactive CSS, dynamic titles, and dynamic script generation
- Special handling required - cannot use standard HTML comment placemarkers in these contexts
- Allows component-scoped reactive styling without CSS-in-JS libraries
- Makes themes, dynamic styling, and conditional scripts natural and performant

**Runtime Components Architecture**: Current implementation focus
- **Evolution**: Moving from compile-time macro expansion to runtime component instantiation
- **Benefits**: Enables dynamic component type selection, shared component behavior, unified replication system
- **Foundation**: Server-side DOM `<template>` implementation with nested light-weight document and clone method
- **No Shadow DOM**: Clean debugging and styling while maintaining encapsulation through scoping system
- **Component Flow**: Parse `<:define>` → Register template → Clone on instantiation → Activate reactive runtime
- **Replication Integration**: `<template :foreach>` uses same component instantiation system
- **Current Status**: Runtime component system needs completion before compiler integration

Example - complete working counter:
```html
<html>
<body>
   <button :count=${0} :on-click=${() => count++}>
      Clicks: ${count}
   </button>
</body>
</html>
```

## Technical Architecture

Built on TypeScript Node.js + Express.js foundation with:

- **Reactive Runtime**: Pull-based reactive system with hierarchical scopes, proxy-based dependency tracking, and polymorphic DOM support (works with both browser DOM and server-side DOM)
- **HTML Parser**: Sophisticated parser for "augmented HTML" with `:` attributes and `${...}` expressions
- **Compiler**: Multi-phase compiler using Acorn for JavaScript AST analysis and escodegen for code generation
  - **Load**: Parse HTML structure and extract scopes/values
  - **Qualify**: Auto-transform expressions with `this.` qualification for lexical scoping
  - **Resolve**: Build dependency graphs for reactive updates
  - **Generate**: Output BaseScopeProps structure for runtime
- **Server-side DOM**: Enables server-side pre-rendering with same reactive logic

## Project Structure

- TypeScript source files in `src/` directory
  - `src/runtime/` - Reactive runtime system (BaseValue, BaseScope, WebScope)
  - `src/html/` - HTML parser, preprocessor, and DOM implementation
  - `src/compiler/` - Multi-phase compiler with AST transformation and dependency analysis
- Compiled JavaScript output in `dist/` directory
- Express.js server foundation
- Test files in `tests/` directory with comprehensive coverage

## Available Scripts

- `npm run dev` - Development server with hot reload (TypeScript)
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Production server (single run)
- `npm run start:prod` - Production server with auto-restart on crashes
- `npm run start:prod` - Production server with PM2 (cluster mode)
- `npm run stop` - Stop PM2 processes
- `npm run restart` - Restart PM2 processes
- `npm run reload` - Graceful reload PM2 processes (zero downtime)
- `npm run logs` - View PM2 logs
- `npm run monit` - Open PM2 monitoring dashboard
- `npm run watch` - Watch TypeScript files and rebuild
- `npm run clean` - Clean the dist directory
- `npm test` - Run tests in watch mode
- `npm run test:run` - Run tests once
- `npm run test:coverage` - Run tests with coverage report
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check if code is formatted

## Development Philosophy

- **Stability over trends**: Focus on getting fundamentals right rather than chasing latest patterns
- **Developer experience first**: Natural syntax that doesn't require learning framework-specific ceremonies
- **Lexical scoping**: Variables work as developers expect - compiler auto-transforms for reactive system
- **Ecosystem compatibility**: Bootstrap wrapper for familiar components, Web Components support (Shoelace, etc.)
- **Thoughtful evolution**: Changes driven by real needs, not marketing pressure

## Development Guidelines

- Use TypeScript for all source code
- Follow Express.js best practices
- Build and test thoroughly - stability is a core value
- Write tests for new features using Vitest
- Use Prettier for consistent code formatting
- Focus on developer experience and API design
- Consider long-term maintenance and stability in all decisions

## API Endpoints

- `GET /` - Hello World message
- `GET /health` - Health check endpoint
- `POST /api/sensitive` - Example endpoint with stricter rate limiting
- `GET /api/rate-limit-status` - Check current rate limit status

## Testing Framework

- **Vitest** - Fast unit test framework with TypeScript support
- **Supertest** - HTTP assertion library for API testing
- **jsdom** - DOM environment for client-side testing
- **Coverage reports** - V8 coverage provider with HTML/JSON output
- Test files located in `tests/` directory
- Automatic environment selection (Node.js vs jsdom based on file naming)

## Testing Environment Selection

Files are automatically assigned to the appropriate test environment:

- `*.dom.test.ts` files run in **jsdom** environment for DOM/client-side testing
- Files in `tests/dom/` or `tests/client/` directories run in **jsdom** environment
- All other test files run in **Node.js** environment for server-side testing

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

Project is ready for development and production use with comprehensive testing, security features, and enterprise-grade process management.
