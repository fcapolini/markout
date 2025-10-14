# Optional Dependencies Implementation Guide

This guide provides step-by-step instructions for implementing the optional dependencies feature in Markout v1.x.

## Overview

The implementation requires changes across multiple compiler phases:
1. **Qualifier Phase**: Detect and transform `?` syntax
2. **Resolver Phase**: Handle optional dependency validation  
3. **Generator Phase**: Generate safe property access code
4. **Runtime Phase**: Support optional chaining in BaseValue

## File Modifications

### 1. Compiler Types (`src/compiler/compiler.ts`)

Add support for optional dependencies in compiler data structures:

```typescript
export interface CompilerValue {
  exp: acorn.Expression | null;
  val: acorn.Expression | string | null;
  refs?: Set<string>;
  optionalRefs?: Set<string>; // NEW: Optional dependency references
  // ... existing properties
}
```

### 2. Qualifier Phase (`src/compiler/qualifier.ts`)

**Location**: `src/compiler/qualifier.ts` lines 20-60

**Changes needed**:
- Detect identifiers ending with `?`
- Transform optional access to use optional chaining
- Track which expressions have optional dependencies

```typescript
// Add after line 16
interface OptionalMemberExpression extends es.MemberExpression {
  optional: true;
  _isOptionalDep?: boolean;
}

// Modify qualifyExpression function (around line 23)
function qualifyExpression(key: string, exp: acorn.Expression) {
  const stack: es.Node[] = [];
  let hasOptionalDeps = false;
  
  const ret = estraverse.replace(exp as es.Node, {
    enter: (node, parent) => {
      stack.push(node);
      
      // NEW: Handle optional property access
      if (node.type === 'Identifier' && node.name.endsWith('?')) {
        if (parent?.type === 'MemberExpression' && parent.property === node) {
          const optionalMember = parent as OptionalMemberExpression;
          optionalMember.optional = true;
          optionalMember._isOptionalDep = true;
          hasOptionalDeps = true;
          
          // Remove '?' from property name
          return {
            ...node,
            name: node.name.slice(0, -1)
          };
        }
      }
      
      // Existing identifier handling logic...
      if (node.type === 'Identifier') {
        // ... existing code
      }
    },
    
    leave: () => {
      stack.pop();
    },
  });
  
  // Store optional dependency flag on the expression
  (ret as any)._hasOptionalDeps = hasOptionalDeps;
  return ret as acorn.Expression;
}
```

### 3. Resolver Phase (`src/compiler/resolver.ts`)

**Location**: `src/compiler/resolver.ts` lines 62-120

**Changes needed**:
- Detect optional member expressions in AST traversal
- Modify validation to allow missing optional dependencies
- Track optional references separately

```typescript
// Modify addValueRef function (around line 62)
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
    
    // NEW: Check for optional access
    const member = node as any; // OptionalMemberExpression
    if (member.optional === true && member._isOptionalDep) {
      isOptional = true;
    }
    
    const p = node.property;
    if (p.type !== 'Identifier' && p.type !== 'Literal') {
      break;
    }
    if (p.type === 'Literal' && typeof p.value !== 'string') {
      break;
    }
    const key = p.type === 'Literal' ? (p.value as string) : p.name;
    path.push(key);
  }
  validateValueRef(source, scope, value, path, node.loc!, isOptional);
}

// Modify validateValueRef function (around line 88)
function validateValueRef(
  source: Source,
  scope: CompilerScope,
  value: CompilerValue,
  path: string[],
  loc: es.SourceLocation,
  optional: boolean = false // NEW: Optional parameter
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
    // NEW: Store as optional reference instead of error
    value.optionalRefs || (value.optionalRefs = new Set());
    value.optionalRefs.add(`this.` + path.join('.'));
    // No error for optional dependencies
  } else {
    source.errors.push(new PageError('warning', 'invalid reference', loc));
  }
}
```

### 4. Generator Phase (`src/compiler/generator.ts`)

**Location**: `src/compiler/generator.ts` (exact location varies)

**Changes needed**:
- Generate optional chaining syntax for optional dependencies
- Handle browser compatibility for optional chaining

```typescript
// Add helper function for generating safe property access
function generateSafeExpression(exp: acorn.Expression): string {
  // Transform optional member expressions to use optional chaining
  const safeAst = estraverse.replace(exp as es.Node, {
    enter: (node) => {
      if (node.type === 'MemberExpression') {
        const member = node as any;
        if (member.optional && member._isOptionalDep) {
          // Generate optional chaining: obj?.prop
          return {
            ...member,
            optional: true
          };
        }
      }
    }
  });
  
  return generate(safeAst);
}

// Modify value generation to use safe expressions
function generateValue(value: CompilerValue): string {
  if (value.optionalRefs && value.optionalRefs.size > 0) {
    return generateSafeExpression(value.exp as acorn.Expression);
  }
  
  // Standard generation for non-optional expressions
  return generate(value.exp as es.Node);
}
```

### 5. Runtime Support (`src/runtime/base/base-value.ts`)

**Location**: `src/runtime/base/base-value.ts` around BaseValue class

**Changes needed**:
- Handle optional property access errors gracefully
- Maintain reactivity for optional dependencies

```typescript
export class BaseValue<T = any> {
  // ... existing properties
  
  get(): T {
    if (this.needsRefresh) {
      try {
        this.cachedValue = this.exp.call(this.scope.proxy);
        this.needsRefresh = false;
      } catch (error) {
        // NEW: Handle optional access errors gracefully
        if (this.hasOptionalDeps && isOptionalAccessError(error)) {
          this.cachedValue = undefined as T;
          this.needsRefresh = false;
        } else {
          throw error;
        }
      }
    }
    return this.cachedValue;
  }
  
  // NEW: Check if this value has optional dependencies
  private get hasOptionalDeps(): boolean {
    // This would be set during compilation based on optionalRefs
    return (this as any)._hasOptionalDeps || false;
  }
}

// NEW: Helper function to detect optional access errors
function isOptionalAccessError(error: any): boolean {
  return error instanceof TypeError && 
         error.message.includes("Cannot read propert");
}
```

## Testing Strategy

### 1. Unit Tests

Create comprehensive test cases in `tests/compiler/optional-deps/`:

```typescript
// tests/compiler/optional-deps/optional-deps.test.ts
describe('Optional Dependencies', () => {
  it('should not error on missing optional property', async () => {
    const compiler = new Compiler({ docroot: __dirname });
    const page = await compiler.compile('optional-missing.html');
    
    expect(page.source.errors).toHaveLength(0);
  });
  
  it('should generate optional chaining syntax', async () => {
    const compiler = new Compiler({ docroot: __dirname });
    const page = await compiler.compile('optional-basic.html');
    
    expect(page.code).toContain('this.head?.darkMode');
  });
  
  it('should handle mixed optional and required deps', async () => {
    const compiler = new Compiler({ docroot: __dirname });  
    const page = await compiler.compile('optional-mixed.html');
    
    // Should have error for required missing dep, not optional
    expect(page.source.errors).toHaveLength(1);
    expect(page.source.errors[0].msg).toBe('invalid reference');
  });
});
```

### 2. Integration Tests

Add runtime tests to verify optional dependency behavior:

```typescript
// tests/integration/optional-deps.test.ts
describe('Optional Dependencies Runtime', () => {
  it('should return undefined for missing optional property', () => {
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

## Migration & Compatibility

### Backward Compatibility
- **100% compatible**: Existing code continues to work unchanged
- **Opt-in feature**: Only affects expressions using `?` syntax
- **No performance impact**: Standard dependencies unchanged

### Browser Support
- **Modern browsers**: Native optional chaining (`?.`)
- **Legacy browsers**: Transpiled to safe property access
- **Polyfill**: Automatic fallback for older environments

## Implementation Checklist

### Phase 1: Core Implementation
- [ ] Extend CompilerValue interface with optionalRefs
- [ ] Modify qualifier.ts to detect `?` syntax
- [ ] Update resolver.ts to handle optional validation
- [ ] Add generator.ts support for optional chaining
- [ ] Create basic test cases

### Phase 2: Runtime Integration  
- [ ] Enhance BaseValue error handling
- [ ] Test reactive updates with optional deps
- [ ] Verify browser compatibility
- [ ] Add integration tests

### Phase 3: Documentation & Polish
- [ ] Update specification with implementation details
- [ ] Create comprehensive examples
- [ ] Add VS Code extension support (future)
- [ ] Performance testing and optimization

## Rollout Strategy

1. **Feature Branch**: Implement on feature/optional-dependencies
2. **Alpha Testing**: Internal testing with prototype applications
3. **Beta Release**: Community testing with v1.x-beta
4. **Stable Release**: Include in v1.0 with full documentation
5. **Ecosystem Support**: VS Code extension and tooling updates

---

This implementation maintains Markout's stability-first philosophy while adding powerful progressive enhancement capabilities for v1.x.