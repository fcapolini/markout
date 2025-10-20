# Valibot Integration for Markout Data Validation

## Overview

This document outlines the implementation of optional data validation in Markout using Valibot library through the fragment-based architecture. This feature maintains Markout's core principles of simplicity, zero bloat, and optional complexity.

## Design Philosophy

### Core Principles
- **Library-First Architecture**: Validation implemented as importable fragments, not runtime features
- **Zero Bloat**: Valibot only loads when validation fragments are imported
- **Optional Complexity**: Simple data remains simple, complex validation available when needed
- **Reactive Integration**: Seamless integration with Markout's existing reactive system
- **Framework Agnostic**: Could theoretically swap Valibot for other validation libraries

### Benefits
- **Bundle Size**: Starts at <700 bytes, tree-shakable to 2-5kB for typical forms
- **Runtime Type Safety**: Immediate validation and error handling without waiting for TypeScript (v2.x)
- **API Integration**: Enables robust GraphQL and tRPC support with schema validation pre-TypeScript
- **Developer Experience**: Natural integration with existing `<:data>` patterns
- **Ecosystem Growth**: Enables community validation libraries and company-specific patterns

## Technical Architecture

### Fragment-Based Implementation

**Core Fragment**: `/lib/validation.htm`
```html
<script type="module">
  // Dynamic Valibot import from CDN
  import * as v from 'https://esm.sh/valibot@0.42.1';
  globalThis.v = v;
  globalThis.ValibotUtils = { /* utility functions */ };
</script>

<:define name="validated-data">
  <!-- Validation service factory -->
</:define>
```

**Usage Pattern**:
```html
<!-- Import validation capabilities -->
<:import src="/lib/validation.htm" />

<!-- Create validated data -->
<:data :aka="form" :json="${validationService.json.createValidatedData({
    schema: userSchema.json,
    json: { name: '', email: '' },
    onValidation: (result) => console.log('Validated:', result)
})}" />
```

### Integration with Existing Systems

**Reactive System Integration**:
- Uses existing `<:data>` directive patterns
- Leverages Markout's proxy-based reactivity
- Automatic UI updates when validation state changes
- Batched DOM updates through existing BaseContext system

**Server-Side Rendering**:
- Validation schemas can be server-rendered
- Client-side hydration preserves validation state
- Error states survive SSR/CSR transitions

## Implementation Components

### 1. Core Validation Service

**Location**: `/lib/validation.htm#validated-data`

**Key Methods**:
```javascript
{
  // Factory method
  createValidatedData(options) {
    const { schema, json, onValidation } = options;
    
    return {
      // Standard data properties
      json: json || {},
      loading: false,
      
      // Validation state
      schema: schema,
      valid: true,
      errors: {},
      lastValidated: null,
      
      // Core methods
      validate(data = this.json),     // Full validation
      patch(updates),                 // Partial update with validation
      validateField(field, value),    // Field-level validation
      reset(),                        // Reset to initial state
      
      // Getters
      get safeJson(),                 // Always returns valid data
      getFieldError(field),           // Get specific field error
      isFieldValid(field)             // Check field validity
    };
  }
}
```

### 2. Valibot Utilities

**Location**: `/lib/validation.htm` (global script)

**Core Functions**:
```javascript
globalThis.ValibotUtils = {
  // Error formatting
  formatErrors(error) {
    // Convert Valibot ValiError to structured object
    // Handle path-based errors for nested validation
  },

  // Safe parsing wrapper
  safeParse(schema, data) {
    // Always returns { success, data, errors } structure
    // Handles exceptions gracefully
  },

  // Common schema factories
  createUserSchema(),     // Name, email, age validation
  createProductSchema(),  // Title, price, category validation
  createContactSchema()   // Contact form with all fields
};
```

### 3. Reusable UI Components

**Validated Field Component**:
```html
<:define name="validated-field">
  <div class="form-group">
    <label>${label}</label>
    <input :type="${type || 'text'}"
           :value="${value}"
           :class="${error ? 'invalid' : (value ? 'valid' : '')}"
           :on-input="${(e) => onInput(e.target.value)}" />
    <span :class-error="${!!error}" :style-display="${error ? 'block' : 'none'}">
      ${error}
    </span>
  </div>
</:define>
```

## Pre-TypeScript API Integration Advantages

### Runtime Type Safety as TypeScript Bridge

Valibot validation provides immediate benefits that don't require TypeScript support:

**1. API Contract Validation**
```html
<!-- GraphQL with runtime schema validation -->
<:import src="/lib/graphql/client.htm" />
<:data :aka="userQuery" :json="${graphql.createQuery({
    query: 'query GetUser($id: ID!) { user(id: $id) { name email } }',
    variables: { id: userId },
    schema: v.object({
        user: v.object({
            name: v.string(),
            email: v.pipe(v.string(), v.email())
        })
    })
})}" />

<!-- Safe data access with validation -->
<div>Welcome ${userQuery.json.safeData.user.name}</div>
```

**2. tRPC Integration with Validation**
```html
<!-- tRPC client with procedure validation -->
<:import src="/lib/trpc/client.htm" />
<:data :aka="api" :json="${trpc.createClient({
    baseUrl: '/api/trpc',
    procedures: {
        createPost: {
            input: v.object({
                title: v.pipe(v.string(), v.minLength(5)),
                content: v.string()
            }),
            output: v.object({
                id: v.string(),
                title: v.string(),
                createdAt: v.string()
            })
        }
    }
})}" />
```

**3. API Evolution Handling**
```html
<!-- Graceful handling of API changes -->
<:data :aka="apiResult" 
       :onValidation="${(result) => {
           if (!result.success) {
               console.warn('API schema changed:', result.errors);
               // Fallback to default values or show error UI
           }
       }}" />
```

**Key Benefits Before TypeScript**:
- **Immediate runtime safety**: Catch API mismatches without compile-time checking
- **Schema documentation**: Valibot schemas serve as living API documentation  
- **Error boundaries**: Graceful handling of API evolution and network issues
- **Development velocity**: Build robust API integrations without waiting for TypeScript support

## Integration Patterns

### Basic Form Validation

```html
<!-- 1. Import validation library -->
<:import src="/lib/validation.htm" />

<!-- 2. Define schema -->
<:data :aka="userSchema" :json="${ValibotUtils.createUserSchema()}" />

<!-- 3. Create validated form -->
<:data :aka="userForm" :json="${validationService.json.createValidatedData({
    schema: userSchema.json,
    json: { name: '', email: '', age: 18 }
})}" />

<!-- 4. Use in UI with reactive validation -->
<input :value="${userForm.json.json.name}"
       :on-input="${(e) => userForm.json.patch({ name: e.target.value })}" />
<span :style-display="${userForm.json.getFieldError('name') ? 'block' : 'none'}">
  ${userForm.json.getFieldError('name')}
</span>
```

### Advanced Validation Patterns

**API Data Validation**:
```html
<:data :aka="apiData" :json="${validationService.json.createValidatedData({
    src: '/api/users',
    schema: apiSchema.json,
    onValidation: (result) => {
        if (!result.success) {
            console.error('API data validation failed:', result.errors);
        }
    }
})}" />
```

**Nested Object Validation**:
```html
<:data :aka="addressSchema" :json="${v.object({
    street: v.pipe(v.string(), v.nonEmpty()),
    city: v.pipe(v.string(), v.nonEmpty()),
    zipCode: v.pipe(v.string(), v.regex(/^\d{5}$/))
})}" />

<:data :aka="userWithAddressSchema" :json="${v.object({
    name: v.pipe(v.string(), v.nonEmpty()),
    address: addressSchema.json
})}" />
```

## File Structure

```
/lib/
  validation.htm              # Core validation fragment
  validation/
    user-schemas.htm          # Common user validation patterns
    product-schemas.htm       # E-commerce validation patterns
    contact-schemas.htm       # Contact form patterns

/examples/
  validation-fragment.htm     # Basic validation demo
  real-valibot-demo.html     # Production validation example
  production-validation-demo.html  # Advanced patterns

/company-lib/                 # Company-specific validation (example)
  payment-validation.htm      # Payment form validation
  address-validation.htm      # Address validation with locale support
  user-management.htm         # User management validation patterns
```

## TypeScript Integration Roadmap

### Phase 1: v2.1 - Basic TypeScript Support
- Hybrid TypeScript/Acorn pipeline for validated expressions
- Basic type inference from Valibot schemas
- IntelliSense for validated data properties

**Implementation**:
```typescript
// Schema type inference
const UserSchema = v.object({
  name: v.string(),
  email: v.pipe(v.string(), v.email())
});

type UserType = v.InferOutput<typeof UserSchema>;
// { name: string; email: string }

// Reactive data with inferred types
<:data :aka="form" :json="${validationService.createValidatedData<UserType>({
    schema: UserSchema,
    json: { name: '', email: '' }
})}" />
```

### Phase 2: v2.2 - Advanced TypeScript Integration
- Complete TypeScript Compiler API integration
- Compile-time validation of schema definitions
- Advanced language features for validation patterns

## Performance Considerations

### Bundle Size Optimization
- **Minimum Load**: ~700 bytes for basic validation
- **Typical Usage**: 2-5kB for standard form validation
- **Tree Shaking**: Only imported validation functions are bundled
- **CDN Caching**: Valibot can be cached across multiple sites

### Validation Performance
- **Field-Level Validation**: Only validates changed fields for UX
- **Batched Updates**: Uses existing Markout batching system
- **Error Caching**: Validation results cached until data changes
- **Async Boundaries**: Validation doesn't block reactive updates

### Memory Management
- **Schema Reuse**: Schemas can be shared across components
- **Validation State**: Minimal overhead for validation metadata
- **Cleanup**: Validation state cleaned up with component lifecycle

## Security Considerations

### Client-Side Validation
- **Never Trust Client**: Server-side validation still required
- **UX Enhancement**: Client validation improves user experience
- **Data Sanitization**: Valibot can transform/sanitize input data

### Schema Validation
- **Schema Security**: Validate schemas themselves for safety
- **Input Sanitization**: Use Valibot's transformation features
- **Error Handling**: Don't expose internal validation logic

## Testing Strategy

### Unit Tests
```javascript
// Test validation service
describe('Valibot Integration', () => {
  test('creates validated data with schema', () => {
    const schema = v.object({ name: v.string() });
    const data = validationService.createValidatedData({
      schema,
      json: { name: 'John' }
    });
    
    expect(data.valid).toBe(true);
    expect(data.json.name).toBe('John');
  });
});
```

### Integration Tests
- Test fragment loading and Valibot availability
- Test schema creation and validation
- Test reactive updates with validation state changes
- Test error handling and fallback scenarios

### End-to-End Tests
- Test complete form validation workflows
- Test server-side rendering with validation state
- Test TypeScript integration (when available)

## Migration Strategy

### Existing Projects
1. **Gradual Adoption**: Add validation to new forms first
2. **Opt-in Basis**: Import validation fragments only where needed
3. **Backward Compatibility**: Existing `<:data>` continues to work unchanged

### Legacy Validation
```html
<!-- Before: Manual validation -->
<:data :aka="form" :json="${{
    data: { email: '' },
    validate() {
        if (!this.data.email.includes('@')) {
            return { valid: false, error: 'Invalid email' };
        }
        return { valid: true };
    }
}}" />

<!-- After: Valibot validation -->
<:import src="/lib/validation.htm" />
<:data :aka="form" :json="${validationService.json.createValidatedData({
    schema: v.object({ email: v.pipe(v.string(), v.email()) }),
    json: { email: '' }
})}" />
```

## Ecosystem Development

### Official Library Publishing Strategy

**NPM Package Distribution Pattern:**
```
@markout-js/data-validation     # Core Valibot integration
@markout-js/ui-bootstrap        # Bootstrap form validation
@markout-js/ui-shoelace         # Shoelace Web Components validation
@markout-js/data-graphql        # GraphQL schema validation
```

**Fragment Resolution from node_modules:**
- Preprocessor enhanced to resolve `@markout-js/*` packages from node_modules
- Security validation allows only approved package patterns
- Automatic dependency resolution maintains zero-ceremony philosophy

### Community Libraries
- **Bootstrap Integration**: Validation for Bootstrap form components
- **Shoelace Integration**: Web Components with validation
- **Industry Patterns**: Address, payment, contact validation libraries

### Company Libraries
```html
<!-- Company-specific validation patterns -->
<:import src="@company/markout-components/lib/user-management.htm" />
<:import src="@company/markout-validation/lib/payment-forms.htm" />
<:import src="@company/markout-patterns/lib/address-validation.htm" />
```

### Third-Party Integration
- **GraphQL Schema Validation**: Generate Valibot schemas from GraphQL
- **OpenAPI Integration**: Generate validation from API specifications  
- **Database Schema Sync**: Keep validation in sync with database constraints

### SSR Compatibility Strategy

**Polymorphic Fragment Implementation:**
```html
<!-- Universal validation that works in both SSR and CSR -->
<script>
  // Server-safe validation core
  function createValidator(schema) {
    return {
      validate: (data) => {
        // Universal validation logic
        if (typeof v !== 'undefined') {
          return v.safeParse(schema, data);
        }
        // Fallback validation for SSR
        return { success: true, data };
      }
    };
  }
  globalThis.createValidator = createValidator;
</script>

<script type="module">
  // Client-side enhancement
  import * as v from 'https://esm.sh/valibot@latest';
  globalThis.v = v;
  // Re-initialize validators with full Valibot
</script>
```

**Current SSR Limitations & Solutions:**
- ES6 module imports don't work in current lightweight SSR eval environment
- Fragment-based approach provides SSR compatibility with progressive enhancement
- Custom JS modules work via static file serving for client-side functionality
- Future consideration: Happy DOM for full browser environment SSR (v0.4.x+)

## Implementation Timeline

### Immediate (Current)
- [x] Basic fragment implementation with mock Valibot
- [x] Real Valibot CDN integration
- [x] Core validation service patterns
- [x] Example implementations and documentation

### Short Term (Next Release)
- [ ] Production-ready validation fragment in `/lib/`
- [ ] Common schema libraries (user, product, contact)
- [ ] Comprehensive test suite
- [ ] Performance optimization and caching

### Medium Term (v0.4.0 - Library Foundations)
- [ ] **GraphQL Integration Library**: Complete GraphQL client with Valibot schema validation
  - [ ] Query/mutation validation with runtime type safety
  - [ ] Subscription support with schema validation
  - [ ] Error boundaries and graceful API evolution handling
- [ ] **tRPC Integration Library**: Type-safe RPC with runtime validation
  - [ ] Procedure input/output validation
  - [ ] Client-server contract enforcement
  - [ ] Runtime API compatibility checking
- [ ] **Advanced API Libraries**: WebSocket, Server-Sent Events with validation
- [ ] Web Components integration patterns
- [ ] Static site generation capabilities
- [ ] Advanced component patterns and reusability

### Long Term (v2.x - TypeScript Integration)
- [ ] Basic TypeScript support (v2.1)
- [ ] IntelliSense support for validated data  
- [ ] VS Code extension validation features
- [ ] Full TypeScript Compiler API integration (v2.2)
- [ ] Advanced schema composition patterns
- [ ] Performance monitoring and optimization
- [ ] Enterprise validation library ecosystem

## Documentation Requirements

### Developer Documentation
- [ ] Getting started guide for validation
- [ ] Common validation patterns cookbook
- [ ] Custom schema creation guide
- [ ] TypeScript integration guide

### API Documentation
- [ ] Validation service API reference
- [ ] Valibot schema patterns
- [ ] Error handling strategies
- [ ] Performance best practices

### Examples and Tutorials
- [ ] Basic form validation tutorial
- [ ] Advanced validation patterns
- [ ] Custom validation libraries
- [ ] Migration from manual validation

## Success Metrics

### Developer Experience
- Time to implement form validation (target: <10 minutes)
- Bundle size impact (target: <5kB for typical forms)
- Learning curve for new validation patterns
- Community adoption of validation fragments

### Technical Metrics
- Validation performance benchmarks
- Bundle size analysis across use cases
- Type safety coverage with TypeScript integration
- Test coverage for validation patterns

### Ecosystem Growth
- Number of community validation libraries
- Company-specific validation pattern adoption  
- Integration with other web technologies
- Contribution to Markout ecosystem maturity

---

## Implementation Checklist

When ready to implement this feature:

- [ ] Create production `/lib/validation.htm` fragment
- [ ] Add Valibot as peer dependency or CDN import
- [ ] Implement core validation service patterns
- [ ] Create common schema libraries
- [ ] Add comprehensive test coverage
- [ ] Update documentation and examples
- [ ] Plan TypeScript integration path
- [ ] Consider performance implications
- [ ] Design ecosystem growth strategy
- [ ] Validate security considerations

This implementation maintains Markout's core philosophy while adding powerful validation capabilities through the elegant fragment-based architecture.