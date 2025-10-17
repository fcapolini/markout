# Foreach Transitions Specification

**Feature**: Animation Transitions for `<template :foreach>`  
**Target Version**: v0.4.0  
**Status**: Specification  
**Type**: Enhancement  

## Overview

Declarative animation transitions for dynamic list items using `:transition-in` and `:transition-out` attributes on `<template :foreach>` elements. Provides elegant, framework-integrated animations for adding and removing items with parametric control over timing and effects.

## Motivation

### Current Limitation
Dynamic lists currently lack smooth transitions when items are added or removed:
```html
<!-- Items appear/disappear instantly -->
<template :foreach="${items}" :key="id">
  <div class="item">${name}</div>
</template>
```

### Desired Behavior
Smooth transitions with declarative syntax and parametric control:
```html
<!-- Items animate in/out with configurable parameters -->
<template :foreach="${items}" :key="id"
  :transition-in="${fadeInUp({ ms: 300, dy: 20 })}"
  :transition-out="${fadeOutUp({ ms: 200, dy: -20 })}">
  <div class="item">${name}</div>
</template>
```

## Core Features

### Key Attribute for Identity Tracking

- **`:key`** - Unique identifier expression for each item (required for transitions)
- Enables efficient DOM updates and proper animation targeting
- Must evaluate to unique, stable values across renders
- Critical for distinguishing between item moves, additions, and removals

### Declarative Animation Attributes

- **`:transition-in`** - Animation when items are added to the list
- **`:transition-out`** - Animation when items are removed from the list
- Function-based syntax with parametric control
- Built-in animation library with common effects

### Built-in Animation Functions

```typescript
// Fade animations
fadeIn({ ms: number })
fadeOut({ ms: number })

// Slide animations  
slideInUp({ ms: number, dy: number })
slideInDown({ ms: number, dy: number })
slideOutUp({ ms: number, dy: number })
slideOutDown({ ms: number, dy: number })

// Combined effects
fadeInUp({ ms: number, dy: number })
fadeOutUp({ ms: number, dy: number })
fadeInDown({ ms: number, dy: number })
fadeOutDown({ ms: number, dy: number })

// Scale animations
scaleIn({ ms: number, from?: number })
scaleOut({ ms: number, to?: number })

// Custom timing
ease({ ms: number, fn: 'ease-in' | 'ease-out' | 'ease-in-out' | 'linear' })
```

### Parameter Options

- **`ms`** - Duration in milliseconds
- **`dy`** - Vertical movement in pixels (positive = down, negative = up)
- **`dx`** - Horizontal movement in pixels (positive = right, negative = left)
- **`from`** - Starting scale value (default: 0)
- **`to`** - Ending scale value (default: 0)
- **`fn`** - Easing function name

### Key Attribute Requirements

The `:key` attribute is **required** for transitions and must provide unique, stable identifiers:

```html
<!-- ✅ Good: Stable unique IDs with explicit item variable -->
<template :foreach="${todos}" :item="todo" :key="${todo.id}" :transition-in="${fadeIn({ ms: 200 })}">
  <div class="todo">${todo.text}</div>
</template>

<!-- ✅ Good: Composite keys for uniqueness -->
<template :foreach="${messages}" :item="message" :key="${`${message.userId}-${message.timestamp}`}" 
  :transition-in="${slideInDown({ ms: 300, dy: -20 })}">
  <div class="message">${message.content}</div>
</template>

<!-- ❌ Bad: Array index (not stable during reordering) -->
<template :foreach="${items}" :item="item" :key="${$index}" :transition-in="${fadeIn({ ms: 200 })}">
  <div class="item">${item.name}</div>
</template>

<!-- ❌ Bad: Non-unique values -->
<template :foreach="${products}" :item="product" :key="${product.category}" :transition-in="${scaleIn({ ms: 300 })}">
  <div class="product">${product.name}</div>
</template>

<!-- ❌ Compiler Error: :key requires :item to be explicitly defined -->
<template :foreach="${todos}" :key="${item.id}" :transition-in="${fadeIn({ ms: 200 })}">
  <div class="todo">${item.text}</div>
</template>
```

#### Key Behavior and Animation Impact

1. **Item Addition**: New key triggers `:transition-in` animation
2. **Item Removal**: Removed key triggers `:transition-out` animation  
3. **Item Reordering**: Same keys moving positions animate to new locations
4. **Item Updates**: Same key with changed data updates in place (no transition)

#### Key Stability Requirements

- **Persistent**: Key should not change during item's lifetime
- **Unique**: No two items should share the same key value
- **Primitive**: String, number, or boolean values (not objects)
- **Deterministic**: Same data should always produce same key

## Implementation Examples

### Basic Fade Transitions
```html
### Basic Fade Transitions
```html
<template :foreach="${todos}" :item="todo" :key="${todo.id}" :transition-in="${fadeIn({ ms: 200 })}"
  :transition-out="${fadeOut({ ms: 150 })}">
  <div class="todo-item">${todo.text}</div>
</template>
```

### Slide Animations with Movement
```html
<template :foreach="${messages}" :item="message" :key="${message.id}" :transition-in="${slideInDown({ ms: 300, dy: -30 })}"
  :transition-out="${slideOutUp({ ms: 250, dy: -20 })}">
  <div class="message">${message.content}</div>
</template>
```

### Complex Animations with Scale
```html
<template :foreach="${cards}" :item="card" :key="${card.id}" :transition-in="${scaleIn({ ms: 400, from: 0.8 })}"
  :transition-out="${scaleOut({ ms: 200, to: 0.9 })}">
  <div class="card">${card.title}</div>
</template>
```

### Custom Timing Functions
```html
<template :foreach="${notifications}" :item="notification" :key="${notification.id}" :transition-in="${fadeInUp({ ms: 250, dy: 10 }).ease('ease-out')}"
  :transition-out="${fadeOutUp({ ms: 200, dy: -5 }).ease('ease-in')}">
  <div class="notification">${notification.message}</div>
</template>
```
```

### Slide Animations with Movement
```html
<template :foreach="${messages}" :key="id"
  :transition-in="${slideInDown({ ms: 300, dy: -30 })}"
  :transition-out="${slideOutUp({ ms: 250, dy: -20 })}">
  <div class="message">${content}</div>
</template>
```

### Complex Animations with Scale
```html
<template :foreach="${cards}" :key="id"
  :transition-in="${scaleIn({ ms: 400, from: 0.8 })}"
  :transition-out="${scaleOut({ ms: 200, to: 0.9 })}">
  <div class="card">${title}</div>
</template>
```

### Custom Timing Functions
```html
<template :foreach="${notifications}" :key="id"
  :transition-in="${fadeInUp({ ms: 250, dy: 10 }).ease('ease-out')}"
  :transition-out="${fadeOutUp({ ms: 200, dy: -5 }).ease('ease-in')}">
  <div class="notification">${message}</div>
</template>
```

## Framework Comparison

### React Implementation
```javascript
// Requires external library
import { TransitionGroup, CSSTransition } from 'react-transition-group';

// Separate CSS file required
import './transitions.css';

function TodoList({ todos }) {
  return (
    <TransitionGroup>
      {todos.map(todo => (
        <CSSTransition key={todo.id} timeout={300} classNames="todo">
          <div className="todo-item">{todo.text}</div>
        </CSSTransition>
      ))}
    </TransitionGroup>
  );
}
```

```css
/* transitions.css - Required separate file */
.todo-enter {
  opacity: 0;
  transform: translateY(20px);
}

.todo-enter-active {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 300ms, transform 300ms;
}

.todo-exit {
  opacity: 1;
  transform: translateY(0);
}

.todo-exit-active {
  opacity: 0;
  transform: translateY(-20px);
  transition: opacity 200ms, transform 200ms;
}
```

### Markout Implementation
```html
<!-- Single file, declarative syntax -->
<template :foreach="${todos}" :key="id"
  :transition-in="${fadeInUp({ ms: 300, dy: 20 })}"
  :transition-out="${fadeOutUp({ ms: 200, dy: -20 })}">
  <div class="todo-item">${text}</div>
</template>
```

**Complexity Comparison**:
- **React**: 4 files (JS, CSS, package.json, package-lock.json) + external dependencies
- **Markout**: Single HTML file with built-in animation support

## Key Management and Performance

### Advanced Key Scenarios

```html
<!-- Hierarchical data with nested keys -->
<template :foreach="${categories}" :item="category" :key="${category.id}">
  <div class="category">
    <h3>${category.name}</h3>
    <template :foreach="${category.items}" :item="item" :key="${`${$parent.category.id}-${item.id}`}"
      :transition-in="${fadeInUp({ ms: 200, dy: 10 })}">
      <div class="item">${item.title}</div>
    </template>
  </div>
</template>

<!-- Dynamic key generation with fallbacks -->
<template :foreach="${users}" :item="user" :key="${user.id || user.email}"
  :transition-in="${slideInLeft({ ms: 250, dx: -30 })}">
  <div class="user">${user.name}</div>
</template>

<!-- Time-sensitive keys for chat messages -->
<template :foreach="${messages}" :item="message" :key="${`${message.id}-${message.timestamp}`}"
  :transition-in="${fadeInDown({ ms: 150, dy: -10 })}">
  <div class="message" :timestamp="${message.timestamp}">${message.text}</div>
</template>
```

### Key Performance Implications

- **DOM Recycling**: Proper keys enable efficient DOM node reuse
- **Animation Targeting**: Keys ensure animations apply to correct elements
- **Memory Management**: Stable keys prevent unnecessary object creation
- **Update Optimization**: Framework can skip unchanged items with matching keys

### Key Algorithm Behavior

1. **Reconciliation**: Compare new keys with previous render keys
2. **Classification**: Identify added, removed, moved, and updated items
3. **Animation Queuing**: Schedule appropriate transitions for each change type
4. **DOM Operations**: Apply minimal DOM changes based on key differences

## Technical Implementation

### Animation Runtime
- CSS transitions generated dynamically based on function parameters
- Animation states managed through CSS classes: `.mo-entering`, `.mo-exiting`
- Non-blocking animations with proper cleanup
- Performance optimized with transform/opacity properties

### Lifecycle Management
```typescript
interface TransitionPhase {
  entering: boolean;   // Item being added
  exiting: boolean;    // Item being removed
  stable: boolean;     // Item in final state
}
```

### Generated CSS Pattern
```css
/* Auto-generated from fadeInUp({ ms: 300, dy: 20 }) */
.mo-entering {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 300ms ease, transform 300ms ease;
}

.mo-entering.mo-entered {
  opacity: 1;
  transform: translateY(0);
}
```

## Browser Support

- **Modern Browsers**: Full support with CSS transitions
- **Legacy Browsers**: Graceful degradation (instant show/hide)
- **Performance**: Hardware-accelerated transforms when supported
- **Accessibility**: Respects `prefers-reduced-motion` setting

## Integration with Reactive System

### Dependency Tracking
Animation functions are reactive expressions that can depend on scope variables:
```html
<template :foreach="${items}" :key="id"
  :transition-in="${fadeInUp({ ms: speed, dy: offset })}"
  :transition-out="${fadeOutUp({ ms: speed * 0.7, dy: -offset })}">
  <div class="item">${name}</div>
</template>
```

### Context Awareness
Animations can adapt based on parent scope context:
```html
<div :animated="${true}">
  <template :foreach="${items}" :key="id"
    :transition-in="${animated ? fadeInUp({ ms: 300, dy: 20 }) : null}"
    :transition-out="${animated ? fadeOutUp({ ms: 200, dy: -20 }) : null}">
    <div class="item">${name}</div>
  </template>
</div>
```

## Future Enhancements

### Custom Animation Functions
```javascript
// User-defined animations
function bounceIn(params) {
  return {
    from: { transform: 'scale(0.3)', opacity: 0 },
    to: { transform: 'scale(1)', opacity: 1 },
    timing: `${params.ms}ms cubic-bezier(0.68, -0.55, 0.265, 1.55)`
  };
}
```

### Gesture Integration
```html
<template :foreach="${items}" :key="id"
  :transition-out="${swipeGesture ? slideOutRight({ ms: 200 }) : fadeOut({ ms: 150 })}">
  <div class="swipeable-item">${name}</div>
</template>
```

### Animation Sequences
```html
<template :foreach="${items}" :key="id"
  :transition-in="${sequence([
    fadeIn({ ms: 100 }),
    slideInUp({ ms: 200, dy: 10 })
  ])}"
  :transition-out="${scaleOut({ ms: 150 })}">
  <div class="complex-item">${content}</div>
</template>
```

## Key Validation and Error Handling

### Development-Time Validation

```typescript
// Compiler errors for invalid key usage
Error: ":key" attribute requires ":item" to be explicitly defined
Location: <template :foreach="..." :key="${item.id}" :transition-in="...">
Resolution: Add :item="item" or use a custom item variable name

// Compiler warnings for problematic key patterns
Warning: ":key=\"${todo.$index}\"" may cause animation issues during reordering
Suggestion: Use stable identifiers like ":key=\"${todo.id}\"" instead

Error: Duplicate key "user-123" found in :foreach list
Resolution: Ensure key expressions produce unique values
```

### Compiler Validation Rules

1. **`:key` requires `:item`**: If `:key` is present, `:item` must be explicitly defined
2. **Key expression scope**: `:key` expressions must reference the defined `:item` variable
3. **Stable key validation**: Warn against using `$index` or other non-stable identifiers
4. **Unique key checking**: Runtime validation for duplicate keys in development mode

### Runtime Key Monitoring

- **Development Mode**: Console warnings for duplicate keys
- **Key Stability Tracking**: Detect keys that change unexpectedly  
- **Performance Metrics**: Report key collision statistics
- **Animation Debugging**: Trace key-based animation decisions

### Graceful Degradation

- **Missing Keys**: Fall back to index-based reconciliation (no transitions)
- **Duplicate Keys**: Use first occurrence, warn about conflicts
- **Invalid Keys**: Convert to strings, log validation errors
- **Performance Fallback**: Disable transitions if key thrashing detected

## Implementation Priority

**Phase 1** (v0.4.0):
- Basic fade and slide animations
- Core parametric syntax
- CSS transition generation
- Key attribute validation and reconciliation

**Phase 2** (v0.5.0):
- Full animation library
- Custom timing functions
- Performance optimizations
- Advanced key scenarios and debugging

**Phase 3** (v1.0.0):
- Custom animation functions
- Gesture integration
- Animation sequences
- Key performance monitoring and analytics

## Benefits

1. **Developer Experience**: Intuitive, declarative syntax
2. **Performance**: Hardware-accelerated CSS transitions
3. **Maintainability**: Single-file implementation vs multi-file React setup
4. **Flexibility**: Parametric control with reactive expressions
5. **Accessibility**: Built-in reduced-motion support
6. **No Dependencies**: Framework-integrated, no external libraries required

This specification ensures Markout maintains its core principle of making complex things simple while providing powerful animation capabilities for dynamic content.