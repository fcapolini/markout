# Contributing to Markout

Welcome! We're excited that you're interested in contributing to Markout. This guide will help you understand the project architecture, set up your development environment, and contribute effectively.

Markout values **thoughtful engineering over marketing hype**. We prioritize stability, developer experience, and building on web standards. Your contributions help make web development simpler and more intuitive.

## Quick Start for Contributors

1. **🍴 Fork the repository** on GitHub
2. **📥 Clone your fork**: `git clone https://github.com/YOUR_USERNAME/markout.git`
3. **📦 Install dependencies**: `npm install`
4. **🔨 Build the project**: `npm run build`
5. **✅ Run tests**: `npm test`
6. **🚀 Start development**: `npm run dev`

## Architecture Overview

Markout is built on a sophisticated multi-layered architecture designed for both developer experience and production reliability. The framework consists of several key components working together:

- **CLI Tool & Server Infrastructure**: Express.js-based server with PM2 clustering, rate limiting, and graceful shutdown
- **Multi-Phase Compiler Pipeline**: 7-phase compilation from HTML to executable reactive structures
- **Reactive Runtime System**: Pull-based reactivity with hierarchical scoping and batched DOM updates
- **HTML Preprocessor**: Module loading, fragment imports, and dependency resolution

For detailed architectural documentation including C4 diagrams, system design principles, and component interactions, see the [Architecture Documentation](docs/architecture/).

Key architectural features:
- **Polymorphic Execution**: Same reactive logic runs on server and client
- **Reserved Namespace**: `$` prefix prevents framework/user code conflicts  
- **Update Batching**: Set-based deduplication eliminates redundant DOM operations
- **Hierarchical Scoping**: Lexical variable lookup with proxy-based reactive access
- **Two-Tier Component System**: Islands (Web Components) for isolation + Components (markup scopes) for composition with service-oriented reactive communication

## Development Setup

### Getting Started

1. **Clone and Setup**:
   ```bash
   git clone https://github.com/fcapolini/markout.git
   cd markout
   npm install
   ```

2. **Build the Project**:
   ```bash
   npm run build    # Build both server and client
   npm run watch    # Watch mode for development
   ```

3. **Run Tests**:
   ```bash
   npm test                # Run all tests
   npm run test:watch      # Watch mode
   npm run test:coverage   # Generate coverage report
   ```

4. **Start Development Server**:
   ```bash
   npm run dev     # Development server with hot reload
   ```

### Project Structure

- **`src/`** - TypeScript source code
  - **`compiler/`** - Multi-phase compilation pipeline
  - **`runtime/`** - Reactive system (BaseContext, BaseScope, BaseValue)
  - **`html/`** - HTML parser and preprocessor
  - **`server/`** - Express.js server and middleware
- **`tests/`** - Comprehensive test suite (245+ tests)
- **`docs/`** - Architecture documentation
- **`scripts/`** - Build configuration (esbuild)

### Development Workflow

Markout includes automated code quality checks via Git hooks powered by [Husky](https://typicode.github.io/husky/):

- **Pre-commit Hook**: Automatically runs before each commit to ensure:
  - Code formatting follows Prettier standards (`npm run format:check`)
  - All tests pass (`npm test`)

You can manually run the same validation:

```bash
npm run precommit
```

For emergencies only, bypass the hook with:

```bash
git commit --no-verify -m "emergency commit"
```

### Testing

Markout has comprehensive test coverage across all components:

- **Unit Tests**: Individual components (compiler phases, runtime classes)
- **Integration Tests**: Compiler-runtime interaction, server middleware
- **Cross-Platform**: Tests run on Windows, macOS, and Linux
- **Coverage Reporting**: Detailed reports with V8 coverage provider

```bash
npm test                # Run all tests once
npm run test:watch      # Interactive watch mode
npm run test:coverage   # Generate coverage report (opens in browser)
```

Test files are organized to mirror the source structure:
- `tests/compiler/` - Compiler phase tests with fixtures
- `tests/runtime/` - Reactive system tests
- `tests/integration/` - End-to-end compilation and execution
- `tests/server/` - Express.js server tests

### Architecture Guidelines

- **Stability First**: Changes must not break existing functionality
- **TypeScript**: All source code uses strict TypeScript
- **Cross-Platform**: Support Windows, macOS, and Linux
- **Performance**: Reactive updates use batching and deduplication
- **Developer Experience**: Keep APIs intuitive and ceremony-free

Key patterns:
- **Reactive System**: Pull-based with hierarchical scopes
- **Compilation**: Multi-phase pipeline with AST transformation
- **DOM Updates**: Batched updates with Set-based deduplication
- **Server-Client Hydration**: Same reactive logic on both sides

### Contributing

1. **Fork the Repository** and create a feature branch
2. **Write Tests** for new functionality using Vitest
3. **Follow Code Style** - Prettier will format automatically
4. **Update Documentation** if adding user-facing features
5. **Ensure Tests Pass** across all supported Node.js versions
6. **Submit Pull Request** with clear description

All contributions are welcome! See issues labeled "good first issue" for beginner-friendly tasks.

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please treat all community members with respect and professionalism. 

## Reporting Issues

**Found a bug?** Please search existing issues first, then create a new issue with:
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, Node.js version, Markout version)

**Have a feature request?** Open an issue with:
- Use case description
- How it aligns with Markout's philosophy
- Proposed API or implementation approach

## Development Philosophy

When contributing to Markout, please keep these principles in mind:

- **Stability First**: Don't break existing functionality - we value backward compatibility
- **HTML-First**: Build on web standards rather than replacing them
- **Simplicity**: Make common tasks simple while keeping complex things possible
- **Performance**: Reactive updates should be efficient and batched
- **Developer Experience**: APIs should be intuitive and ceremony-free
- **Thoughtful Evolution**: Changes should be driven by real user needs, not trends

## Development Scripts

```bash
# Build and Development
npm run build           # Build both server and client
npm run watch          # Watch TypeScript files
npm run dev            # Development server with nodemon
npm run clean          # Clean build directory

# Testing and Quality
npm test               # Run tests once
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Generate coverage report
npm run format         # Format code with Prettier
npm run format:check   # Check formatting

# Production
npm start              # Start production server
npm run start:prod     # Start with PM2 cluster mode
npm run logs           # View PM2 logs
npm run monit          # Open PM2 monitoring
```
