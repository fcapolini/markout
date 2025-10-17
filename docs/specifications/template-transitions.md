# Template Transitions Specification

**Feature**: Animation Transitions for All Template Blocks  
**Target Version**: v0.4.0  
**Status**: Specification  
**Type**: Enhancement  

## Overview

Unified transition system for all `<template>` blocks in Markout, including both `<template :foreach>` (dynamic lists) and `<template :if>` (conditionals). Provides consistent animation API and runtime behavior across all template directives.

## Motivation

### Design Consistency
All `<template>` blocks control when content appears and disappears:
- **`<template :foreach>`**: Items appear/disappear based on array changes
- **`<template :if>`**: Blocks appear/disappear based on boolean evaluation

They should share the same transition capabilities and API design.

### Developer Expectations
If loops can animate smoothly, conditionals should too:

```html
<!-- This should work (already planned) -->
<template :foreach="${items}" :key="id"
  :transition-in="${fadeIn({ ms: 300 })}"
  :transition-out="${fadeOut({ ms: 200 })}">
  <div class="item">${name}</div>
</template>

<!-- This should work too (proposed) -->
<template :if="${showWelcome}"
  :transition-in="${fadeIn({ ms: 300 })}"
  :transition-out="${fadeOut({ ms: 200 })}">
  <div class="welcome">Welcome to our platform!</div>
</template>
```

## Unified API Design

### Shared Transition Attributes

All `<template>` blocks support the same transition attributes:

- **`:transition-in`** - Animation when content appears
- **`:transition-out`** - Animation when content disappears  
- **`:transition-duration`** - Default duration for both (optional)

### Animation Function Library

Same animation functions work across all `<template>` contexts:

```javascript
// Fade animations
fadeIn({ ms: 300 })
fadeOut({ ms: 200 })

// Slide animations  
slideInUp({ ms: 300, dy: 20 })
slideOutDown({ ms: 200, dy: 30 })

// Scale animations
scaleIn({ ms: 400, from: 0.8 })
scaleOut({ ms: 300, to: 0.9 })

// Combined animations
fadeInUp({ ms: 300, dy: 20 })
fadeOutUp({ ms: 200, dy: -20 })
```

## Implementation Examples

### Conditional Transitions

```html
<!-- Loading state with fade -->
<template :if="${isLoading}"
  :transition-in="${fadeIn({ ms: 200 })}"
  :transition-out="${fadeOut({ ms: 100 })}">
  <div class="loading-spinner">Loading...</div>
</template>

<!-- Error messages with slide -->
<template :if="${error}"
  :transition-in="${slideInDown({ ms: 300, dy: -20 })}"
  :transition-out="${slideOutUp({ ms: 200, dy: -30 })}">
  <div class="error-banner">${error}</div>
</template>

<!-- Welcome banner with combined animation -->
<template :if="${showWelcome}"
  :transition-in="${fadeInUp({ ms: 400, dy: 30 })}"
  :transition-out="${fadeOutUp({ ms: 300, dy: -20 })}">
  <div class="welcome-banner">
    <h2>Welcome back, ${user.name}!</h2>
    <p>You have ${notifications.length} new messages.</p>
  </div>
</template>
```

### List Transitions (Existing)

```html
<!-- Dynamic todo list -->
<template :foreach="${todos}" :key="id"
  :transition-in="${slideInLeft({ ms: 300, dx: -30 })}"
  :transition-out="${slideOutRight({ ms: 250, dx: 30 })}">
  <div class="todo-item">${text}</div>
</template>

<!-- Photo gallery -->
<template :foreach="${photos}" :key="id"
  :transition-in="${scaleIn({ ms: 400, from: 0.8 })}"
  :transition-out="${scaleOut({ ms: 300, to: 0.8 })}">
  <img src="${photo.url}" alt="${photo.caption}" />
</template>
```

### Complex Conditional Logic

```html
<!-- Multi-state UI with coordinated transitions -->
<template :if="${state === 'loading'}"
  :transition-in="${fadeIn({ ms: 200 })}"
  :transition-out="${fadeOut({ ms: 100 })}">
  <div class="state-loading">Loading...</div>
</template>

<template :elseif="${state === 'error'}"
  :transition-in="${slideInDown({ ms: 300, dy: -20 })}"
  :transition-out="${slideOutUp({ ms: 200, dy: -20 })}">
  <div class="state-error">Error: ${errorMessage}</div>
</template>

<template :else="${state === 'success'}"
  :transition-in="${fadeInUp({ ms: 400, dy: 20 })}"
  :transition-out="${fadeOutDown({ ms: 300, dy: 20 })}">
  <div class="state-success">
    <h3>Success!</h3>
    <p>Your data has been saved.</p>
  </div>
</template>
```

## Technical Implementation

### Unified Animation Runtime

```typescript
interface TransitionConfig {
  ms: number;           // Duration in milliseconds
  dx?: number;          // X-axis movement
  dy?: number;          // Y-axis movement  
  from?: number;        // Scale from value
  to?: number;          // Scale to value
  ease?: string;        // Timing function
}

interface AnimationFunction {
  (config: TransitionConfig): CSSTransition;
}

interface CSSTransition {
  from: CSSProperties;
  to: CSSProperties;
  timing: string;
}
```

### Template Block Lifecycle

```typescript
interface TemplateBlock {
  type: 'foreach' | 'if' | 'elseif' | 'else';
  visible: boolean;
  transitionIn?: AnimationFunction;
  transitionOut?: AnimationFunction;
  
  // Trigger transitions
  show(): Promise<void>;
  hide(): Promise<void>;
}
```

### Conditional-Specific Behavior

- **Boolean evaluation**: `:if` expressions trigger transitions on `false ↔ true` changes
- **No key management**: Unlike `:foreach`, conditionals don't need `:key` attributes
- **Instant evaluation**: Conditional expressions are evaluated immediately, not diffed
- **Chain coordination**: `if/elseif/else` chains coordinate transitions between states

### Foreach-Specific Behavior  

- **Array diffing**: Changes trigger transitions for added/removed/moved items
- **Key requirement**: `:key` attribute required for proper identity tracking
- **Batch animations**: Multiple simultaneous changes are batched efficiently
- **Move animations**: Item reordering triggers position transitions

## Benefits

### For Developers
- **Consistent API**: Same syntax across all `<template>` types
- **Predictable behavior**: Animations work the same way everywhere
- **Easier learning**: Master transitions once, use everywhere
- **Better UX**: Smooth animations for all dynamic content

### For Framework
- **Unified codebase**: Single animation system, not separate implementations  
- **Easier maintenance**: One transition system to optimize and debug
- **Consistent performance**: Same batching and optimization for all animations
- **Future extensibility**: Easy to add new `<template>` types with transitions

## Migration Path

1. **Design unified animation runtime** (shared between all `<template>` types)
2. **Implement `<template :foreach>` transitions** using unified system
3. **Implement `<template :if>` conditionals** with transition support from day one
4. **Add `:elseif` and `:else`** with coordinated transition behavior
5. **Optimize and extend** animation library based on real-world usage

This approach ensures that when conditionals are implemented, they'll have full transition support from the beginning, creating a cohesive and polished developer experience.