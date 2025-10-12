# Level 3: Server Infrastructure Components

This diagram shows the components within the Server Infrastructure container and their interactions.

```mermaid
C4Component
    title Component diagram for Server Infrastructure

    Container_Boundary(server, "Server Infrastructure") {
        Component(express_app, "Express Application", "server.ts", "Main HTTP server with middleware pipeline")
        Component(markout_middleware, "Markout Middleware", "middleware.ts", "Core SSR/CSR handling, compilation, page serving")
        Component(rate_limiter, "Rate Limiter", "express-rate-limit", "DoS protection and API throttling")
        Component(compression, "Compression", "compression", "Gzip/Brotli response compression")
        
        Component(logger, "Logger", "logger.ts", "Structured logging with timestamps and levels")
        Component(exit_handler, "Exit Handler", "exit-hook.ts", "Graceful shutdown and PM2 compatibility")
        Component(static_server, "Static Server", "express.static", "CSS, JS, images with caching")
        
        Component(pm2_manager, "PM2 Manager", "ecosystem.config.js", "Process clustering and health monitoring")
        Component(health_monitor, "Health Monitor", "Built-in", "Health check endpoints and status")
    }

    Container_Ext(compiler, "Compiler Pipeline", "Compiles Markout pages")
    Container_Ext(runtime, "Server Runtime", "Executes reactive logic")
    Container_Ext(filesystem, "File System", "Source files and assets")
    Container_Ext(browser, "Web Browser", "Client requests")

    Rel(browser, express_app, "HTTP Requests", "GET, POST, etc.")
    Rel(express_app, rate_limiter, "Applies", "Request throttling")
    Rel(express_app, compression, "Applies", "Response compression")
    Rel(express_app, markout_middleware, "Routes", "Markout page requests")
    Rel(express_app, static_server, "Serves", "Static assets")
    Rel(express_app, logger, "Logs", "Requests and errors")
    
    Rel(markout_middleware, compiler, "Compiles", "On-demand compilation")
    Rel(markout_middleware, runtime, "Executes", "Server-side rendering")
    Rel(markout_middleware, filesystem, "Reads", "Source files")
    
    Rel(pm2_manager, express_app, "Manages", "Process lifecycle")
    Rel(health_monitor, express_app, "Monitors", "Application health")
    Rel(exit_handler, express_app, "Handles", "Shutdown signals")
    
    Rel(logger, filesystem, "Writes", "Log files")

    UpdateElementStyle(express_app, $fontColor="white", $bgColor="blue", $borderColor="darkblue")
    UpdateElementStyle(markout_middleware, $fontColor="white", $bgColor="green", $borderColor="darkgreen")
    UpdateElementStyle(pm2_manager, $fontColor="white", $bgColor="orange", $borderColor="darkorange")
```

## Core Server Components

### Express Application
- **HTTP Server**: Main web server handling all incoming requests
- **Middleware Pipeline**: Ordered execution of middleware components
- **Routing**: URL pattern matching and request dispatch
- **Error Handling**: Centralized error processing and recovery
- **Static Assets**: Serving CSS, JS, images with proper caching headers

**Key Features:**
- RESTful API endpoints (`/health`, `/api/*`)
- Middleware composition with proper error boundaries
- Development vs production configuration
- Request/response logging and monitoring

### Markout Middleware - Core Request Handler
- **SSR/CSR Decision**: Determines server-side vs client-side rendering approach
- **On-demand Compilation**: Compiles Markout pages only when needed
- **Caching**: Compiled page caching for performance
- **State Transfer**: Preparing server state for client hydration
- **Error Recovery**: Graceful handling of compilation and runtime errors

**Request Flow:**
1. Receive request for `.html` or Markout page
2. Check compilation cache for existing compiled version
3. Compile if needed using Compiler Pipeline
4. Execute server-side rendering with Runtime System
5. Generate HTML with embedded client runtime
6. Send pre-rendered response to browser

### Rate Limiter
- **DoS Protection**: Prevents denial-of-service attacks
- **API Throttling**: Different limits for different endpoint types
- **Client Tracking**: IP-based rate limiting with sliding windows
- **Header Information**: Rate limit status in response headers
- **Configurable Limits**: Different limits for general vs sensitive endpoints

**Rate Limiting Strategy:**
- General endpoints: 100 requests per 15 minutes
- Sensitive endpoints: 5 requests per 15 minutes
- Memory-based tracking with automatic cleanup
- Standard HTTP 429 responses when limits exceeded

## Production Infrastructure

### PM2 Process Manager
- **Cluster Mode**: Multiple Node.js processes utilizing all CPU cores
- **Health Monitoring**: Automatic restart on crashes or memory leaks
- **Zero-downtime Deployment**: Graceful reloads without service interruption
- **Log Management**: Centralized logging with rotation
- **Resource Monitoring**: CPU and memory usage tracking

**PM2 Configuration:**
```javascript
{
  name: 'markout-server',
  script: 'dist/index.js',
  instances: 'max',        // Use all CPU cores
  exec_mode: 'cluster',    // Load balancing
  max_memory_restart: '1G', // Memory leak protection
  error_file: 'logs/err.log',
  out_file: 'logs/out.log'
}
```

### Health Monitor
- **Health Check Endpoint**: `/health` endpoint for load balancer monitoring
- **Application Status**: Database connections, external service availability
- **Performance Metrics**: Response times, error rates, throughput
- **Alerting Integration**: Ready for external monitoring systems

### Exit Handler - Graceful Shutdown
- **Signal Handling**: SIGTERM, SIGINT for graceful shutdown
- **Connection Draining**: Finish processing existing requests
- **Resource Cleanup**: Close database connections, file handles
- **PM2 Compatibility**: Proper integration with PM2 restart cycles
- **Timeout Protection**: Force exit if graceful shutdown takes too long

## Supporting Components

### Logger
- **Structured Logging**: JSON format with timestamps and levels
- **Request Logging**: HTTP request/response details
- **Error Tracking**: Stack traces and error context
- **Performance Logging**: Response times and performance metrics
- **Log Rotation**: Automatic log file rotation and cleanup

**Log Levels:**
- `error`: Application errors and exceptions
- `warn`: Warning conditions and recovery
- `info`: General application information
- `debug`: Detailed debugging information (development only)

### Compression Middleware
- **Gzip/Brotli**: Automatic response compression
- **Content-Type Filtering**: Only compress appropriate content types
- **Size Threshold**: Skip compression for very small responses
- **Cache Integration**: Proper caching headers with compression

### Static File Server
- **Asset Serving**: CSS, JavaScript, images, fonts
- **Caching Headers**: Proper cache control for performance
- **ETag Support**: Conditional requests for unchanged assets
- **Content Type Detection**: Automatic MIME type detection
- **Security Headers**: Prevent content sniffing and XSS

## Security Features

### Request Security
- **Rate Limiting**: Protection against abuse and DoS attacks
- **Input Validation**: Sanitization of user inputs
- **Error Handling**: No sensitive information in error responses
- **Security Headers**: CSRF, XSS, and other security protections

### Production Hardening
- **Process Isolation**: Each PM2 worker runs in isolation
- **Memory Limits**: Automatic restart on memory leaks
- **Error Recovery**: Graceful handling of worker crashes
- **Log Security**: No sensitive data in logs

## Development vs Production

### Development Mode Features
- **Hot Reload**: Automatic server restart on file changes
- **Enhanced Logging**: Detailed debugging information
- **Error Pages**: Developer-friendly error reporting
- **Source Maps**: Better debugging experience

### Production Optimizations
- **Process Clustering**: Full CPU utilization
- **Response Caching**: Aggressive caching for performance
- **Error Handling**: User-friendly error pages
- **Security Headers**: Full security header suite
- **Log Rotation**: Automated log management

## Performance Characteristics

### Server Performance
- **Response Times**: < 50ms for cached pages, < 200ms for compilation
- **Throughput**: Thousands of requests per second with clustering
- **Memory Usage**: ~50MB per worker process
- **CPU Usage**: Efficient compilation and rendering pipeline

### Scalability
- **Horizontal Scaling**: Multiple PM2 workers per server
- **Load Balancing**: Built-in round-robin load balancing
- **Caching**: Compilation results cached in memory
- **Resource Efficiency**: Minimal overhead per request