# Service-Oriented Island Architecture

Markout's island architecture uses a service-oriented approach for inter-island communication, leveraging the existing `<:data>` system to provide reactive, async-capable services.

## Core Concepts

### 🏝️ **Islands as Services**
Islands can expose services by registering with a name, making their reactive data available to other islands.

**GraphQL Service Example (Library-based):**
```html
<!-- GraphQL user service island using library components -->
<:island src="/services/graphql-user.htm" name="userGraphQLService">
  <!-- Import GraphQL client library -->
  <:import src="/lib/graphql/client.htm" 
           :aka="graphqlClient"
           :endpoint="/graphql" />
           
  <:data :aka="userService" :json="${{
    async getUser(id) {
      return await graphqlClient.query(`
        query GetUser($id: ID!) {
          user(id: $id) {
            id name email
            profile { avatar bio }
          }
        }
      `, { id });
    },
    
    async updateUser(id, updates) {
      const result = await graphqlClient.mutate(`
        mutation UpdateUser($id: ID!, $updates: UserInput!) {
          updateUser(id: $id, input: $updates) {
            id name email
            profile { avatar bio }
          }
        }
      `, { id, updates });
      
      this.refresh(); // Notify all consumers
      return result;
    }
  }}" />
</:island>
```

**WebSocket Service Example (Library-based):**
```html
<!-- Real-time chat service island using library components -->
<:island src="/services/chat.htm" name="chatService">
  <!-- Import WebSocket client library -->
  <:import src="/lib/websocket/client.htm"
           :aka="chatSocket"
           :url="wss://chat.example.com/rooms/general"
           :on-message="${(context, event) => {
             const message = JSON.parse(event.data);
             return {
               ...context,
               messages: [...context.messages, message]
             };
           }}" />
         
  <:data :aka="chatService" :json="${{
    sendMessage(text) {
      const message = {
        text,
        user: currentUser.name,
        timestamp: Date.now()
      };
      chatSocket.send(JSON.stringify(message));
    },
    
    get messages() { return chatSocket.json.messages || []; },
    get isConnected() { return chatSocket.json.connected; }
  }}" />
</:island>
```

**Traditional Data Service Example:**
```html
<!-- Cart service island -->
<:island src="/services/cart.htm" name="cartService">
  <:data :aka="cartData" :src="/api/cart/local" />
  <:data :aka="cartService" :json="${{
    // Public API methods
    async addItem(item) {
      await cartData.json.db.put('cartItems', item);
      cartData.json.items.push(item);
      cartData.json.total += item.price;
      cartData.refresh(); // Notify all consumers
    },
    
    get items() { return cartData.json.items || []; },
    get total() { return cartData.json.total || 0; },
    get count() { return this.items.length; }
  }}" />
</:island>
```

### 🔌 **Service Consumption**
Other islands consume services using `<:data :src="@serviceName">` syntax, enabling reactive data flow.

```html
<!-- Product listing consuming cart service -->
<:island src="/widgets/product-list.htm">
  <:data :aka="cart" :src="@cartService" />
  
  <div :foreach="products">
    <div class="product">
      <h3>${product.name}</h3>
      <button :on-click="${() => cart.json.addItem(product)}">
        Add to Cart
      </button>
    </div>
  </div>
  
  <!-- Cart badge automatically updates -->
  <div class="cart-badge">
    Cart: ${cart.json.count} items ($${cart.json.total})
  </div>
</:island>
```

## Async Service Patterns

### **GraphQL Real-time Integration (Library-based)**
GraphQL subscriptions implemented using fragment libraries and WebSocket components:

```html
<!-- GraphQL real-time service using library components -->
<:island src="/services/live-data.htm" name="liveDataService">
  <!-- Import GraphQL query library -->
  <:import src="/lib/graphql/query.htm"
           :aka="userData"
           :endpoint="/graphql"
           :query="${`query GetUser($id: ID!) { user(id: $id) { id name email } }`}"
           :variables="${{ id: currentUserId }}" />
         
  <!-- Import GraphQL subscription library (built on WebSocket library) -->
  <:import src="/lib/graphql/subscription.htm"
           :aka="liveUpdates"
           :endpoint="/graphql"
           :subscription="${`
             subscription OnUserUpdate($userId: ID!) {
               userUpdated(userId: $userId) {
                 id name email status
               }
             }
           `}"
           :variables="${{ userId: currentUserId }}"
           :on-data="${(context, data) => {
             // Merge subscription data with existing state
             userData.json.user = { ...userData.json.user, ...data.userUpdated };
             userData.refresh();
             return context;
           }}" />

  <:data :aka="liveDataService" :json="${{
    async updateUser(updates) {
      return await userData.mutate(`
        mutation UpdateUser($id: ID!, $updates: UserInput!) {
          updateUser(id: $id, input: $updates) {
            id name email status
          }
        }
      `, { id: userData.json.user.id, updates });
    },
    
    get user() { return userData.json.user; },
    get isLive() { return liveUpdates.json.connected; }
  }}" />
</:island>
```

### **WebSocket Real-time Collaboration (Library-based)**
Complex WebSocket features implemented using reusable fragment libraries:

```html
<!-- Collaborative document service using library components -->
<:island src="/services/collaboration.htm" name="collaborationService">
  <!-- Import collaborative WebSocket library -->
  <:import src="/lib/websocket/collaboration.htm"
           :aka="docSocket"
           :url="wss://collab.example.com/doc/${documentId}"
           :authentication="${userToken}"
           :on-message="${(context, event) => {
             const data = JSON.parse(event.data);
             
             switch(data.type) {
               case 'user_cursor':
                 return {
                   ...context,
                   cursors: { ...context.cursors, [data.userId]: data.position }
                 };
                 
               case 'text_operation':
                 return {
                   ...context,
                   operations: [...context.operations, data.operation]
                 };
                 
               case 'user_joined':
                 return {
                   ...context,
                   activeUsers: [...context.activeUsers, data.user]
                 };
             }
           }}" />

  <:data :aka="collaborationService" :json="${{
    sendCursorUpdate(position) {
      docSocket.send(JSON.stringify({
        type: 'cursor_update',
        position,
        userId: currentUser.id
      }));
    },
    
    sendTextOperation(operation) {
      docSocket.send(JSON.stringify({
        type: 'text_operation',
        operation,
        userId: currentUser.id
      }));
    },
    
    get activeCursors() { return docSocket.json.cursors || {}; },
    get isConnected() { return docSocket.json.connected; },
    get activeUsers() { return docSocket.json.activeUsers || []; }
  }}" />
</:island>
```

**Library Architecture Benefits:**
- **Reusable Components**: Collaboration patterns as importable `.htm` libraries
- **Zero Runtime Bloat**: Advanced features only loaded when imported
- **Community Ecosystem**: Teams can share domain-specific WebSocket patterns
- **Company Standards**: Internal libraries for consistent real-time integration approaches

### **Local Database Integration**
Services can handle complex async operations like IndexedDB while maintaining simple reactive interfaces.

```html
<!-- User service with local storage -->
<:island src="/services/user.htm" name="userService">
  <:data :aka="userDB" :src="/api/user/local"
         :will-load="${async () => {
           const db = await openUserDB();
           return { db, loading: true };
         }}"
         :did-load="${async (context) => {
           const profile = await context.db.get('userProfile');
           return { ...context, profile, loading: false };
         }}" />

  <:data :aka="userService" :json="${{
    async login(credentials) {
      const user = await this.authenticate(credentials);
      await userDB.json.db.put('userProfile', user);
      userDB.json.profile = user;
      userDB.refresh();
      return user;
    },
    
    async logout() {
      await userDB.json.db.clear();
      userDB.json.profile = null;
      userDB.refresh();
    },
    
    get currentUser() { return userDB.json.profile; },
    get isAuthenticated() { return !!this.currentUser; },
    get isLoading() { return userDB.json.loading; }
  }}" />
</:island>
```

### **Service Dependencies**
Services can depend on other services, creating a dependency graph.

```html
<!-- Order service depending on cart and user services -->
<:island src="/services/order.htm" name="orderService">
  <:data :aka="cart" :src="@cartService" />
  <:data :aka="user" :src="@userService" />
  
  <:data :aka="orderService" :json="${{
    async createOrder() {
      if (cart.json.isLoading || user.json.isLoading) {
        throw new Error('Services not ready');
      }
      
      const order = {
        userId: user.json.currentUser.id,
        items: cart.json.items,
        total: cart.json.total,
        timestamp: Date.now()
      };
      
      // Save locally first (optimistic)
      await this.saveOrderLocally(order);
      
      // Sync to server
      const response = await fetch('/api/orders', {
        method: 'POST',
        body: JSON.stringify(order)
      });
      
      if (response.ok) {
        await cart.json.clear();
      }
      
      return await response.json();
    }
  }}" />
</:island>
```

## Consumer Patterns

### **Loading States**
Consumers automatically handle loading states from async services.

```html
<:island src="/widgets/user-profile.htm">
  <:data :aka="user" :src="@userService" />
  
  <div :if="${user.json.isLoading}">Loading user profile...</div>
  
  <div :if="${!user.json.isLoading && user.json.isAuthenticated}">
    <h2>Welcome, ${user.json.currentUser.name}!</h2>
    <button :on-click="${() => user.json.logout()}">Logout</button>
  </div>
  
  <div :if="${!user.json.isLoading && !user.json.isAuthenticated}">
    <p>Please log in to continue.</p>
  </div>
</:island>
```

### **Multi-Service Consumption**
Islands can consume multiple services simultaneously.

```html
<:island src="/widgets/checkout.htm">
  <:data :aka="cart" :src="@cartService" />
  <:data :aka="user" :src="@userService" />
  <:data :aka="orders" :src="@orderService" />
  
  <div class="checkout">
    <h3>Checkout</h3>
    
    <div :if="${cart.json.count === 0}">
      Your cart is empty.
    </div>
    
    <div :if="${cart.json.count > 0}">
      <div>Items: ${cart.json.count}</div>
      <div>Total: $${cart.json.total}</div>
      
      <button :disabled="${!user.json.isAuthenticated}"
              :on-click="${async () => {
                await orders.json.createOrder();
                alert('Order placed successfully!');
              }}">
        ${user.json.isAuthenticated ? 'Place Order' : 'Login Required'}
      </button>
    </div>
  </div>
</:island>
```

## Advanced Patterns

### **Background Services**
Services can run background operations transparently.

```html
<!-- Sync service for offline capability -->
<:island src="/services/sync.htm" name="syncService">
  <:data :aka="cart" :src="@cartService" />
  <:data :aka="orders" :src="@orderService" />
  
  <:data :aka="syncManager" :json="${{
    async startBackgroundSync() {
      setInterval(async () => {
        try {
          await this.syncPendingData();
        } catch (error) {
          console.warn('Background sync failed:', error);
        }
      }, 30000);
    },
    
    async syncPendingData() {
      // Sync cart changes
      if (cart.json.hasUnsyncedChanges) {
        await cart.json.syncToServer();
      }
      
      // Sync pending orders
      if (orders.json.hasPendingOrders) {
        await orders.json.syncPendingOrders();
      }
    }
  }}" />
</:island>
```

### **Service Health Monitoring**
```html
<!-- Health monitor service -->
<:island src="/services/health.htm" name="healthService">
  <:data :aka="services" :json="${['cartService', 'userService', 'orderService']}" />
  
  <:data :aka="healthService" :json="${{
    getServiceHealth() {
      return services.json.map(serviceName => {
        const service = window.__MARKOUT_SERVICES?.[serviceName];
        return {
          name: serviceName,
          available: !!service,
          responsive: service?.json ? 'healthy' : 'unknown'
        };
      });
    },
    
    get allServicesHealthy() {
      return this.getServiceHealth().every(s => s.available);
    }
  }}" />
</:island>
```

## Architecture Benefits

### 1. **Reactive by Design**
- All service communication uses existing `<:data>` reactive system
- Consumers automatically update when service state changes
- No manual event handling or state synchronization needed

### 2. **Async Transparency**
- Services handle complex async operations internally
- Consumers work with simple reactive interfaces
- Loading states and error handling managed by service layer

### 3. **Decoupled Architecture**
- Islands don't need direct references to each other
- Services can be replaced without affecting consumers
- Clear separation between service interface and implementation

### 4. **Familiar Development Model**
- Uses existing Markout `<:data>` syntax and concepts
- No new APIs or frameworks to learn
- Leverages reactive system developers already understand

### 5. **Offline-First Capable**
- Services can implement local-first data storage
- Background sync happens transparently
- Optimistic updates with server reconciliation

## Implementation Notes

### Service Registration
```typescript
// <:island> directive creates Web Components that register services
class MarkoutIslandElement extends HTMLElement {
  connectedCallback() {
    const name = this.getAttribute('name');
    if (name) {
      window.__MARKOUT_SERVICES = window.__MARKOUT_SERVICES || {};
      window.__MARKOUT_SERVICES[name] = this.markoutContext.root;
    }
  }
}
```

### Service Resolution
```typescript
// <:data :src="@serviceName"> resolves to registered services
// Compiler transforms @serviceName to service lookup
```

This service-oriented approach makes Markout islands feel like **microservices for the frontend** while maintaining the framework's core principles of simplicity, reactivity, and web standards alignment.