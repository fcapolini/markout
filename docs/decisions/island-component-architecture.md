# Island/Component Architecture Decision

## Context

Markout needed a solution for multiple independent applications on the same page while maintaining its core philosophy of simplicity and web standards alignment.

## Decision

Implement a **Two-Tier Component Architecture** for Markout 1.x:

### 🏝️ Islands = Web Components (Heavy Isolation)
- **Syntax**: `<markout-island src="/widgets/counter.htm">`
- **Implementation**: Web Components with Shadow DOM
- **Isolation**: Complete CSS/DOM boundaries, independent reactive contexts
- **Communication**: DOM events, attributes, slots (web standards)
- **Use Cases**: Widgets, micro-frontends, third-party integration, cross-team development

### 🧩 Components = Markup Scopes (Light Composition)
- **Syntax**: `<:import>`, `<:define>` (existing directives)
- **Implementation**: Lexical scoping within shared reactive context
- **Isolation**: Reactive value scoping, shared styling context
- **Communication**: Direct scope access, shared reactive state
- **Use Cases**: UI patterns, layout components, data presentation within apps

## Benefits

1. **Clear Mental Model**: "Heavy isolation" vs "Light composition"
2. **Performance Optimized**: Isolation overhead only where needed
3. **Web Standards Based**: Built on Web Components, not framework abstractions
4. **Backward Compatible**: Existing components continue to work
5. **Ecosystem Friendly**: Islands can wrap any existing component library
6. **Progressive Enhancement**: Start simple, add isolation when needed

## Implementation Plan

- **Target**: Markout 1.x release
- **Approach**: Build Web Component wrapper that loads and compiles Markout HTML
- **Integration**: Islands can contain regular Markout components internally
- **Communication**: Standard DOM events for island-to-island communication

## Alternatives Considered

1. **Same-Page Multi-App Registry** - Complex coordination system
2. **Iframe Islands** - Complete isolation but performance overhead
3. **Shadow DOM Only** - Chosen approach balances isolation and performance

## Status

- **Documentation**: Updated in README.md, copilot-instructions.md, ROADMAP.md, architecture/00-overview.md
- **Implementation**: Planned for 1.x release
- **Testing**: Will require comprehensive Web Component testing suite

## Service-Oriented Communication

Islands communicate through reactive services using the existing `<:data>` system:

### Syntax
```html
<!-- Service island -->
<:island src="/services/cart.htm" name="cartService">
  <:data :aka="cartService" :json="${{ 
    addItem: async (item) => { /* ... */ },
    get items() { return this._items; }
  }}" />
</:island>

<!-- Consumer island -->
<:island src="/widgets/products.htm">
  <:data :aka="cart" :src="@cartService" />
  <button :on-click="${() => cart.json.addItem(product)}">Add to Cart</button>
</:island>
```

### Benefits
- **Async Transparency**: Services handle IndexedDB, API calls, etc. internally
- **Reactive by Design**: Uses existing `<:data>` reactive system
- **Decoupled**: Islands don't reference each other directly
- **Type-Safe**: Clear service contracts through `<:data>` interfaces

This decision aligns with Markout's philosophy of "thoughtful design from the start" and provides a elegant solution that leverages web platform primitives and existing reactive data systems.