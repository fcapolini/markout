# Optional Dependencies Specification

**Feature**: Optional Dependencies with `?` Syntax  
**Target Version**: v1.x  
**Status**: Specification  
**Type**: Enhancement  

## Overview

Optional dependencies allow reactive expressions to gracefully handle missing scope variables by using a `?` suffix syntax. Instead of compilation errors for undefined references, optional dependencies return `undefined` when the dependency chain is broken, enabling progressive enhancement and conditional features.

## Motivation

### Current Limitation
Currently, all dependencies must exist at compile time or result in compilation errors:
```html
<!-- This causes compilation error if head.darkMode doesn't exist -->
<div :class="${head.darkMode ? 'dark' : 'light'}">
```

### Desired Behavior
With optional dependencies, components can gracefully handle missing variables:
```html
<!-- This works even if head.darkMode doesn't exist -->
<div :class="${head.darkMode? ? 'dark' : 'light'}">
```

### Use Cases

1. **Theme-Aware Components**: Components that adapt when theme systems are available
2. **Progressive Enhancement**: Features that degrade gracefully without dependencies
3. **Configuration Overrides**: Default behavior when configuration variables are missing
4. **Dynamic Imports**: References to potentially unloaded modules or fragments
5. **Conditional Features**: Components that work in multiple contexts with different scope variables

## Syntax

### Basic Syntax
```html
<!-- Optional single property -->
<div :visible="${config.showSidebar?}">

<!-- Optional nested property -->
<div :theme="${user.preferences.theme?}">

<!-- Mixed optional and required -->
<div :class="${theme.darkMode? && user.loggedIn}">
```

### Chaining Behavior
```html
<!-- Each level can be optional -->
<div :value="${deeply.nested.optional.chain?}">

<!-- Partial optional chains -->
<div :value="${user.settings?.theme.darkMode?}">
```

### Complex Expressions
```html
<!-- Optional in ternary expressions -->
<div :text="${user.name? || 'Anonymous'}">

<!-- Optional in function calls -->
<button :on-click="${() => analytics.track?('click', data)}">

<!-- Optional with default values -->
<div :count="${data.items?.length || 0}">
```

## Technical Implementation

### Phase 1: AST Parsing (Qualifier Phase)

**Location**: `src/compiler/qualifier.ts`

The qualifier phase needs to recognize and preserve optional dependency markers:

```typescript
// Detect MemberExpression nodes ending with '?'
function transformOptionalAccess(node: es.MemberExpression): es.Node {
  if (isOptionalAccess(node)) {
    // Transform: head.darkMode? -> head?.darkMode
    return {
      ...node,
      optional: true,
      property: {
        ...node.property,
        name: node.property.name.slice(0, -1) // Remove '?' suffix
      }
    };
  }
  return node;
}

function isOptionalAccess(node: es.MemberExpression): boolean {
  return node.property.type === 'Identifier' && 
         node.property.name.endsWith('?');
}
```

### Phase 2: Dependency Resolution (Resolver Phase)

**Location**: `src/compiler/resolver.ts`

Modify `addValueRef` to detect optional access patterns:

```typescript
function addValueRef(
  source: Source,
  scope: CompilerScope,
  value: CompilerValue,
  node: es.ThisExpression,
  stack: es.Node[]
) {
  const path: string[] = [];
  let isOptional = false;
  
  for (let i = stack.length - 2; i >= 0; i--) {
    const node = stack[i];
    if (node.type !== 'MemberExpression') {
      break;
    }
    
    // Detect optional access
    if (node.optional === true) {
      isOptional = true;
    }
    
    const p = node.property;
    if (p.type !== 'Identifier' && p.type !== 'Literal') {
      break;
    }
    
    const key = p.type === 'Literal' ? (p.value as string) : p.name;
    path.push(key);
  }
  
  validateValueRef(source, scope, value, path, node.loc!, isOptional);
}
```

Update `validateValueRef` to handle optional dependencies:

```typescript
function validateValueRef(
  source: Source,
  scope: CompilerScope,
  value: CompilerValue,
  path: string[],
  loc: es.SourceLocation,
  optional: boolean = false
) {
  for (let i = 0; i < path.length; i++) {
    const slice = path[i];
    const target = lookup(scope, slice);
    if (!target) {
      break;
    }
    if (!target.value) {
      scope = target.scope;
      continue;
    }
    // Found complete path
    path.length = i + 1;
    const s = `this.` + path.join('.');
    value.refs || (value.refs = new Set());
    value.refs.add(s);
    return;
  }
  
  // Path not found
  if (optional) {
    // Store as optional reference for runtime handling
    value.optionalRefs || (value.optionalRefs = new Set());
    value.optionalRefs.add(`this.` + path.join('.'));
  } else {
    source.errors.push(new PageError('warning', 'invalid reference', loc));
  }
}
```

### Phase 3: Code Generation (Generator Phase)

**Location**: `src/compiler/generator.ts`

Generate safe property access code for optional dependencies:

```typescript
function generateExpression(value: CompilerValue): string {
  // Handle optional references
  if (value.optionalRefs && value.optionalRefs.size > 0) {
    return generateSafeExpression(value);
  }
  
  // Standard expression generation
  return generate(value.val as es.Node);
}

function generateSafeExpression(value: CompilerValue): string {
  // Transform optional access to safe property chains
  const ast = value.val as es.Node;
  
  return estraverse.replace(ast, {
    enter: (node) => {
      if (node.type === 'MemberExpression' && node.optional) {
        // Generate: this.head?.darkMode
        return {
          ...node,
          type: 'OptionalMemberExpression'
        };
      }
    }
  });
}
```

### Phase 4: Runtime Support

**Location**: `src/runtime/base/base-value.ts`

Enhance BaseValue to handle optional property access:

```typescript
export class BaseValue<T = any> {
  // ... existing code
  
  evaluateExpression(): T {
    try {
      const result = this.exp.call(this.scope.proxy);
      return result;
    } catch (error) {
      // Handle optional access errors gracefully
      if (this.hasOptionalRefs && isPropertyAccessError(error)) {
        return undefined as T;
      }
      throw error;
    }
  }
  
  private get hasOptionalRefs(): boolean {
    // Check if this value has optional references
    return this.refs?.some(ref => ref.includes('?.')) || false;
  }
}

function isPropertyAccessError(error: any): boolean {
  return error instanceof TypeError && 
         error.message.includes("Cannot read propert");
}
```

## Data Structures

### CompilerValue Extension
```typescript
interface CompilerValue {
  // ... existing properties
  optionalRefs?: Set<string>;  // NEW: Optional dependency references
}
```

### AST Node Extension
```typescript
interface OptionalMemberExpression extends es.MemberExpression {
  optional: true;  // Marks this as optional access
}
```

## Runtime Behavior

### Safe Property Access
Optional dependencies use JavaScript's optional chaining operator (`?.`) where available, or polyfill for older browsers:

```javascript
// Generated code for: head.darkMode?
function() { 
  return this.head?.darkMode; 
}

// Fallback for older browsers:
function() { 
  try {
    return this.head && this.head.darkMode;  
  } catch {
    return undefined;
  }
}
```

### Dependency Tracking
Optional dependencies still participate in the reactive system:
- When the optional property becomes available, dependent expressions re-evaluate
- When the optional property is removed, dependent expressions re-evaluate with `undefined`

## Error Handling

### Compile-Time Behavior
- Optional dependencies that don't exist: **No error** (silent handling)
- Required dependencies that don't exist: **Warning/Error** (existing behavior)
- Malformed optional syntax: **Compilation error** with helpful message

### Runtime Behavior
- Optional property access returns `undefined` instead of throwing
- Expressions handle `undefined` values gracefully
- Dependent reactive values update when optional dependencies change

## Testing Strategy

### Unit Tests
```typescript
describe('Optional Dependencies', () => {
  it('should handle missing optional property', () => {
    const scope = createScope({});
    const value = createValue(':x=${missing.prop?}');
    expect(value.get()).toBe(undefined);
  });
  
  it('should update when optional property becomes available', () => {
    const scope = createScope({});
    const value = createValue(':x=${config.theme?}');
    
    expect(value.get()).toBe(undefined);
    
    scope.set('config', { theme: 'dark' });
    expect(value.get()).toBe('dark');
  });
});
```

### Integration Tests
```html
<!-- Test: Optional theme integration -->
<div :class="${theme.mode? === 'dark' ? 'bg-dark' : 'bg-light'}">
  Content with optional theming
</div>

<!-- Test: Progressive enhancement -->
<button :disabled="${!validation.isValid?}">
  Submit (works with or without validation)
</button>
```

## Migration Path

### Backward Compatibility
- **100% backward compatible**: Existing code continues to work unchanged
- **Opt-in feature**: Developers choose when to use optional dependencies
- **No performance impact**: Only affects expressions that use the `?` syntax

### Adoption Strategy
1. **Documentation**: Clear examples showing benefits
2. **Best Practices**: Guidelines for when to use optional vs required dependencies
3. **Tooling Support**: VS Code extension highlights optional dependencies
4. **Community Examples**: Component libraries demonstrating patterns

## Future Enhancements

### v1.1+ Potential Features
- **Nested optional chains**: `user.profile?.settings?.theme?`
- **Optional method calls**: `analytics.track?.('event')`
- **Default value syntax**: `config.timeout? || 5000`
- **Optional destructuring**: `{name?, email?} = user.profile?`

### Developer Experience
- **IntelliSense**: VS Code extension shows which dependencies are optional
- **Debugging**: Runtime helpers show when optional dependencies are undefined
- **Validation**: Lint rules for consistent optional dependency usage

## Implementation Timeline

### Phase 1: Core Implementation (2 weeks)
- [ ] AST parsing and transformation in qualifier phase
- [ ] Dependency resolution updates in resolver phase  
- [ ] Basic code generation for optional access
- [ ] Unit tests for compiler phases

### Phase 2: Runtime Integration (1 week)
- [ ] Runtime support for optional property access
- [ ] Reactive system integration
- [ ] Error handling and edge cases
- [ ] Integration tests

### Phase 3: Developer Experience (1 week)
- [ ] Comprehensive documentation
- [ ] Example components and patterns
- [ ] Performance testing and optimization
- [ ] Migration guide for existing projects

## Success Metrics

### Technical Goals
- ✅ Zero breaking changes to existing code
- ✅ Compile-time detection of optional vs required dependencies
- ✅ Runtime performance equivalent to required dependencies
- ✅ Full reactive system integration

### Developer Experience Goals  
- ✅ Intuitive syntax that feels natural to JavaScript developers
- ✅ Clear error messages for malformed optional syntax
- ✅ Comprehensive documentation with real-world examples
- ✅ Smooth migration path for existing components

### Ecosystem Impact
- ✅ Enables more flexible component libraries
- ✅ Reduces barriers to component reuse across projects
- ✅ Supports progressive enhancement patterns
- ✅ Maintains Markout's stability-first philosophy

---

*Specification Version: 1.0*  
*Last Updated: October 2025*  
*Status: Ready for Implementation*