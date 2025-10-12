# Markout Documentation

Welcome to the Markout framework documentation. This directory contains comprehensive guides, architecture documentation, and examples for the Markout HTML-based reactive web framework.

## Getting Started

- **[README.md](../README.md)** - Main project documentation with examples and usage
- **[Package.json](../package.json)** - Dependencies and available scripts

## Architecture Documentation

The [`architecture/`](architecture/) directory contains detailed C4 architectural diagrams and documentation:

- **[Architecture Overview](architecture/00-overview.md)** - Comprehensive architecture guide
- **[System Context](architecture/01-system-context.md)** - How Markout fits in the ecosystem
- **[Container Diagram](architecture/02-container.md)** - Major framework containers
- **[Compiler Components](architecture/03-compiler-components.md)** - Multi-phase compilation pipeline
- **[Runtime Components](architecture/03-runtime-components.md)** - Reactive runtime system
- **[Server Components](architecture/03-server-components.md)** - Production server infrastructure

## Key Features

### HTML-First Development
- Enhance HTML with `:attributes` and `${expressions}` 
- No build step required for development
- Works with existing HTML/CSS/JS knowledge

### Reactive System
- Pull-based reactivity with automatic dependency tracking
- Batched DOM updates prevent layout thrashing
- Hierarchical scoping with lexical variable lookup

### Production Ready
- Express.js server with PM2 clustering
- Rate limiting and security headers
- Comprehensive testing (178+ tests)
- Cross-platform compatibility

### Ecosystem Integration
- Bootstrap component wrapping
- Shoelace Web Components support
- Fragment-based modularity system

## Development

### Available Scripts
```bash
npm run dev          # Development server with hot reload
npm run build        # Build server and client bundles
npm test             # Run comprehensive test suite
npm run test:watch   # Run tests in watch mode
npm start            # Production server
npm run start:prod   # PM2 clustered production
```

### CLI Usage
```bash
# Serve Markout project
node dist/index.js serve <docroot> [--port 3000]

# Example
node dist/index.js serve . --port 8080
```

## Project Structure

```
markout2/
├── src/                    # TypeScript source code
│   ├── compiler/          # Multi-phase compiler
│   ├── runtime/           # Reactive runtime system
│   ├── server/            # Express.js server
│   └── html/              # HTML processing
├── tests/                 # Comprehensive test suite
├── docs/                  # Documentation (you are here)
├── scripts/               # Build scripts
└── dist/                  # Compiled output
```

## Contributing

See the main [README.md](../README.md) for development guidelines. Key points:

- Use TypeScript for all source code
- Write tests for new features using Vitest
- Follow Prettier formatting standards
- Ensure cross-platform compatibility
- Focus on developer experience and stability

## Links

- **GitHub Repository**: [fcapolini/markout2](https://github.com/fcapolini/markout2)
- **CI/CD Status**: [![CI](https://github.com/fcapolini/markout2/actions/workflows/ci.yml/badge.svg)](https://github.com/fcapolini/markout2/actions/workflows/ci.yml)
- **Test Coverage**: [![codecov](https://codecov.io/gh/fcapolini/markout/graph/badge.svg?token=VENQIX1AWP)](https://codecov.io/gh/fcapolini/markout)