# Markout Architecture Documentation

This directory contains C4 architectural diagrams that document the structure and design of the Markout framework.

## Diagram Overview

The documentation follows the [C4 model](https://c4model.com/) approach:

- **Level 1 - System Context**: Shows how Markout fits into the broader ecosystem
- **Level 2 - Container**: Shows the major containers that make up Markout  
- **Level 3 - Component**: Shows the components within the most important containers
- **Level 4 - Code**: Shows implementation details of the most important components

## Files

- [`00-overview.md`](00-overview.md) - Comprehensive architecture overview and philosophy
- [`01-system-context.md`](01-system-context.md) - System Context diagram
- [`02-container.md`](02-container.md) - Container diagram
- [`03-compiler-components.md`](03-compiler-components.md) - Compiler Pipeline components
- [`03-runtime-components.md`](03-runtime-components.md) - Reactive Runtime components  
- [`03-server-components.md`](03-server-components.md) - Server Infrastructure components
- [`04-core-classes.md`](04-core-classes.md) - Core runtime classes (BaseContext, BaseScope, BaseValue)

## Viewing the Diagrams

All diagrams use Mermaid syntax and can be viewed directly on GitHub. For local viewing, you can use:

- VS Code with the Mermaid Preview extension
- Any Markdown viewer that supports Mermaid
- The [Mermaid Live Editor](https://mermaid.live/)

## Architecture Principles

Markout is built on several key architectural principles:

- **HTML-first approach**: Build on HTML rather than trying to replace it
- **Polymorphic execution**: Same reactive logic works on server and client
- **Hierarchical scoping**: Lexical variable lookup with reactive proxy system
- **Multi-phase compilation**: Sophisticated compiler pipeline with dependency analysis
- **Developer experience**: Natural syntax without framework ceremonies