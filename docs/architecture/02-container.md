# Level 2: Container Diagram

This diagram shows the major containers that make up the Markout framework and how they interact.

```mermaid
C4Container
    title Container diagram for Markout Framework

    Person(developer, "Web Developer", "Creates Markout applications")
    Person(enduser, "End User", "Uses web applications")

    Container_Boundary(markout, "Markout Framework") {
        Container(cli, "CLI Tool", "Node.js, Commander.js", "Development server, project scaffolding, build tools")
        Container(server, "Web Server", "Express.js, Node.js", "HTTP server with SSR, middleware, rate limiting, PM2 clustering")
        Container(compiler, "Compiler Pipeline", "TypeScript, Acorn AST", "Multi-phase compilation: parse, validate, qualify, resolve, generate")
        Container(runtime_server, "Server Runtime", "TypeScript, Server DOM", "Reactive execution on server with DOM pre-rendering")
        Container(runtime_client, "Client Runtime", "JavaScript, Browser DOM", "Reactive execution in browser with DOM hydration")
        Container(preprocessor, "HTML Preprocessor", "Custom Parser", "Module loading, fragment imports, dependency resolution")
    }

    System_Ext(browser, "Web Browser", "Renders applications")
    System_Ext(nodejs, "Node.js", "Runtime environment")
    ContainerDb(filesystem, "File System", "HTML, CSS, JS", "Source files and static assets")

    Rel(developer, cli, "Uses", "markout serve, build commands")
    Rel(developer, filesystem, "Creates", ".html files with Markout syntax")
    
    Rel(enduser, browser, "Uses")
    Rel(browser, server, "Requests pages", "HTTP/HTTPS")
    
    Rel(cli, server, "Starts", "Development/production server")
    Rel(server, compiler, "Compiles pages", "On-demand compilation")
    Rel(server, runtime_server, "Executes", "Server-side rendering")
    Rel(server, browser, "Serves", "Pre-rendered HTML + client runtime")
    
    Rel(compiler, preprocessor, "Uses", "Module resolution and imports")
    Rel(compiler, filesystem, "Reads", "Source files")
    Rel(preprocessor, filesystem, "Loads", "Fragment dependencies")
    
    Rel(runtime_server, runtime_client, "Hydrates", "State transfer")
    Rel(browser, runtime_client, "Executes", "Client-side reactivity")
    
    Rel_Back(server, nodejs, "Runs on")
    Rel_Back(cli, nodejs, "Runs on")
    Rel_Back(compiler, nodejs, "Runs on")
    Rel_Back(runtime_server, nodejs, "Runs on")

    UpdateElementStyle(server, $fontColor="white", $bgColor="blue", $borderColor="darkblue")
    UpdateElementStyle(compiler, $fontColor="white", $bgColor="green", $borderColor="darkgreen")
    UpdateElementStyle(runtime_server, $fontColor="white", $bgColor="orange", $borderColor="darkorange")
    UpdateElementStyle(runtime_client, $fontColor="white", $bgColor="orange", $borderColor="darkorange")
```

## Container Responsibilities

### CLI Tool
- **Development Server**: Hot-reload development environment with live compilation
- **Production Management**: PM2 integration, clustering, health monitoring  
- **Project Scaffolding**: Templates for different project types (Bootstrap, Shoelace, minimal)
- **Build Tools**: Static site generation, PWA builds, bundle analysis

### Web Server (Express.js)
- **HTTP Server**: Request handling with middleware pipeline
- **Server-Side Rendering**: Pre-rendering pages with reactive logic
- **Static Assets**: Serving CSS, JS, images with compression
- **Rate Limiting**: DoS protection and API throttling
- **Process Management**: PM2 clustering, graceful shutdown, health checks

### Compiler Pipeline
- **Multi-Phase Compilation**: Load → Validate → Qualify → Resolve → Treeshake → Generate
- **AST Analysis**: JavaScript expression parsing and transformation using Acorn
- **Dependency Resolution**: Building reactive value dependency graphs
- **Code Generation**: Converting to executable BaseScopeProps structures
- **Optimization**: Dead code elimination and scope hierarchy optimization

### HTML Preprocessor  
- **Module Loading**: Fragment imports with `<:import>` directive
- **Dependency Resolution**: Automatic deduplication and loading order
- **Syntax Support**: `:attributes` and `${expressions}` in HTML
- **Component System**: `<:define>` for reusable components

### Server Runtime
- **Reactive Execution**: BaseContext/BaseScope/BaseValue system on server
- **DOM Pre-rendering**: Server-side DOM with HTML generation
- **State Preparation**: Preparing state for client-side hydration
- **Performance**: Batched updates and dependency tracking

### Client Runtime
- **DOM Hydration**: Taking over from server-rendered state
- **Reactive Updates**: Real-time DOM updates based on state changes
- **Event Handling**: User interaction processing
- **State Management**: Client-side reactive state with browser APIs

## Technology Stack

- **Languages**: TypeScript (server), JavaScript (client)
- **Runtime**: Node.js 18+ with Express.js framework
- **Compilation**: Acorn (AST), esbuild (bundling), custom HTML parser
- **Process Management**: PM2 with clustering and monitoring
- **Testing**: Vitest with comprehensive coverage (178+ tests)
- **Build System**: npm scripts with cross-platform compatibility