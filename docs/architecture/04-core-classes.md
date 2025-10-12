# Level 4: Core Runtime Classes

This diagram shows the key classes and their relationships in the most critical part of the Markout runtime system.

```mermaid
classDiagram
    class BaseContext {
        -refreshLevel: number
        -pendingUpdates: Set~BaseValue~
        -scopes: Map~string, BaseScope~
        +refresh(): void
        +createScope(props): BaseScope
        +addPendingUpdate(value): void
        +processPendingUpdates(): void
    }

    class BaseScope {
        -parent: BaseScope | null
        -context: BaseContext
        -values: Map~string, BaseValue~
        -proxy: Proxy
        +get(name: string): any
        +set(name: string, value: any): void
        +createValue(name, expression): BaseValue
        +updateValues(): void
        +$parent: BaseScope
        +$value(name): BaseValue
    }

    class BaseValue {
        -name: string
        -expression: string | Function
        -scope: BaseScope
        -dependencies: Set~BaseValue~
        -dependents: Set~BaseValue~
        -cached: any
        -isDirty: boolean
        +get(): any
        +set(value: any): void
        +invalidate(): void
        +evaluate(): any
        +addDependency(value): void
        +removeDependency(value): void
    }

    class WebContext {
        -elementMap: Map~Element, WebScope~
        +mapElement(element, scope): void
        +unmapElement(element): void
        +findScope(element): WebScope
    }

    class WebScope {
        -element: Element
        -attributeValues: Map~string, BaseValue~
        -classValues: Map~string, BaseValue~
        -styleValues: Map~string, BaseValue~
        -eventHandlers: Map~string, Function~
        +bindAttribute(name, value): void
        +bindClass(name, value): void
        +bindStyle(name, value): void
        +bindEvent(name, handler): void
        +updateDOM(): void
    }

    class BaseGlobal {
        +console: Console
        +setTimeout: Function
        +setInterval: Function
        +fetch: Function
        +document: Document
        +window: Window
    }

    %% Relationships
    BaseContext ||--o{ BaseScope : manages
    BaseScope ||--o{ BaseValue : contains
    BaseScope ||--o| BaseScope : parent-child
    BaseValue }o--o{ BaseValue : dependencies
    
    WebContext --|> BaseContext : extends
    WebScope --|> BaseScope : extends
    BaseGlobal --|> BaseScope : extends
    
    WebContext ||--o{ WebScope : element mapping
    WebScope ||--o| Element : DOM binding

    %% Composition relationships
    BaseScope --* BaseContext : context
    BaseValue --* BaseScope : scope
    WebScope --* Element : element
```

## Core Class Responsibilities

### BaseContext - Reactive Coordinator
**Purpose**: Central coordinator for the entire reactive system

**Key Responsibilities**:
- **Refresh Cycle Management**: Tracks `refreshLevel` to coordinate update batching
- **Scope Lifecycle**: Creates and manages scope hierarchy
- **Update Batching**: Maintains `pendingUpdates` Set for efficient DOM updates
- **Cross-Scope Coordination**: Ensures updates propagate correctly across scope boundaries

**Critical Methods**:
- `refresh()`: Triggers reactive update cycle, processes pending updates when `refreshLevel` reaches 0
- `createScope(props)`: Instantiates new scopes from compiler output
- `addPendingUpdate(value)`: Queues values for batched DOM updates
- `processPendingUpdates()`: Executes all pending DOM updates in single batch

### BaseScope - Hierarchical Variable Access
**Purpose**: Provides lexical scoping with reactive proxy-based access

**Key Responsibilities**:
- **Variable Resolution**: Implements JavaScript-like lexical scoping rules
- **Proxy Access**: Transparent reactive access to scope variables
- **Parent Chain**: Maintains parent-child relationships for variable inheritance
- **Value Management**: Creates and manages reactive values within scope

**Critical Methods**:
- `get(name)`: Resolves variables up the parent chain
- `set(name, value)`: Sets variables with reactive propagation
- `createValue(name, expression)`: Creates new reactive values
- `$parent`: Provides access to parent scope variables
- `$value(name)`: Framework method for reactive value creation

### BaseValue - Reactive Value Container
**Purpose**: Individual reactive value with dependency tracking and lazy evaluation

**Key Responsibilities**:
- **Expression Evaluation**: Executes JavaScript expressions in scope context
- **Dependency Tracking**: Automatically tracks which values depend on others
- **Change Propagation**: Notifies dependents when value changes
- **Lazy Evaluation**: Only evaluates when value is actually needed
- **Caching**: Caches results until dependencies change

**Critical Methods**:
- `get()`: Returns current value, evaluating if dirty
- `set(value)`: Updates value and propagates changes to dependents
- `invalidate()`: Marks value as dirty, triggering re-evaluation
- `evaluate()`: Executes expression and updates dependency relationships
- `addDependency(value)`: Establishes bidirectional dependency relationship

## Browser-Specific Extensions

### WebContext - DOM-Aware Context
**Purpose**: Extends BaseContext with DOM element mapping capabilities

**Additional Responsibilities**:
- **Element Mapping**: Maps DOM elements to their corresponding WebScope instances
- **DOM Lifecycle**: Manages scope creation/destruction tied to DOM elements
- **Event Coordination**: Coordinates DOM events across reactive scopes

### WebScope - DOM-Binding Scope
**Purpose**: Extends BaseScope with DOM manipulation capabilities

**Additional Responsibilities**:
- **Attribute Binding**: Updates DOM attributes reactively (`:attr-name`)
- **Class Management**: Dynamic CSS class addition/removal (`:class-name`)
- **Style Updates**: Direct style property manipulation (`:style-name`)
- **Event Handling**: DOM event registration and management (`:on-event`)
- **DOM Batching**: Participates in batched DOM update system

**DOM Update Methods**:
- `bindAttribute(name, value)`: Creates reactive attribute binding
- `bindClass(name, value)`: Creates reactive CSS class binding
- `bindStyle(name, value)`: Creates reactive style property binding
- `bindEvent(name, handler)`: Registers DOM event handler
- `updateDOM()`: Applies all pending DOM changes in single batch

## Key Design Patterns

### Proxy-Based Reactive Access
```typescript
// BaseScope creates transparent reactive access
const proxy = new Proxy(this, {
  get(target, prop) {
    // Automatic dependency tracking on property access
    return target.get(prop as string);
  },
  set(target, prop, value) {
    // Automatic change propagation on property updates
    target.set(prop as string, value);
    return true;
  }
});
```

### Set-Based Update Batching
```typescript
// BaseContext batches updates using Set deduplication
class BaseContext {
  private pendingUpdates = new Set<BaseValue>();
  
  addPendingUpdate(value: BaseValue) {
    this.pendingUpdates.add(value); // Automatic deduplication
  }
  
  processPendingUpdates() {
    // Process each unique update only once
    for (const value of this.pendingUpdates) {
      value.updateDOM();
    }
    this.pendingUpdates.clear();
  }
}
```

### Bidirectional Dependency Tracking
```typescript
// BaseValue maintains both dependencies and dependents
class BaseValue {
  addDependency(dependency: BaseValue) {
    this.dependencies.add(dependency);
    dependency.dependents.add(this); // Bidirectional
  }
  
  invalidate() {
    this.isDirty = true;
    // Propagate to all dependents
    for (const dependent of this.dependents) {
      dependent.invalidate();
    }
  }
}
```

## Performance Characteristics

### Memory Efficiency
- **Lazy Evaluation**: Values only computed when accessed
- **Automatic Cleanup**: Unused dependencies garbage collected
- **Set-Based Deduplication**: No duplicate update processing
- **Hierarchical Scoping**: Efficient variable resolution

### Update Performance  
- **Batched DOM Updates**: Single layout/paint cycle per update batch
- **Surgical Updates**: Only changed values trigger DOM updates
- **Dependency Pruning**: Unused dependencies automatically removed
- **Proxy Optimization**: Minimal overhead for property access

### Scalability
- **O(1) Variable Access**: Proxy-based property resolution
- **O(n) Dependency Updates**: Linear with actual dependencies, not component count
- **Bounded Memory Growth**: Automatic cleanup prevents memory leaks
- **Efficient Event Handling**: Event delegation where appropriate

This class structure provides the foundation for Markout's reactive system, enabling efficient, automatic updates while maintaining a clean, intuitive programming model.