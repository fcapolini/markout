# Level 1: System Context Diagram

This diagram shows how the Markout framework fits into the broader ecosystem and its relationships with external systems and users.

```mermaid
C4Context
    title System Context diagram for Markout Framework

    Person(developer, "Web Developer", "Creates reactive web applications using HTML-based syntax")
    Person(enduser, "End User", "Interacts with web applications built with Markout")
    
    System(markout, "Markout Framework", "HTML-based reactive web framework with server-side rendering and client-side hydration")
    
    System_Ext(browser, "Web Browser", "Renders Markout applications and executes client-side reactive runtime")
    System_Ext(nodejs, "Node.js Runtime", "Executes Markout server and compilation processes")
    System_Ext(npm, "NPM Registry", "Distributes Markout CLI and framework packages")
    System_Ext(vscode, "VS Code", "Development environment with Markout syntax highlighting and IntelliSense")
    System_Ext(cicd, "CI/CD Pipeline", "Builds, tests, and deploys Markout applications")
    
    Rel(developer, markout, "develops with")
    Rel(developer, vscode, "uses")
    Rel(developer, npm, "installs from")
    
    Rel(enduser, browser, "uses")
    Rel(browser, markout, "requests")
    
    Rel(markout, nodejs, "runs on")
    Rel(markout, browser, "serves")
    
    Rel(cicd, markout, "deploys")
    
    UpdateElementStyle(markout, $fontColor="white", $bgColor="blue", $borderColor="darkblue")
    UpdateRelStyle(developer, markout, $textColor="blue", $lineColor="blue", $offsetX="5")
    UpdateRelStyle(markout, browser, $textColor="green", $lineColor="green")
```

## Key Relationships

### Developer Interactions
- **Development**: Developers write applications using Markout's HTML-based syntax with reactive `:attributes` and `${expressions}`
- **Tooling**: Integration with VS Code provides syntax highlighting, IntelliSense, and development support
- **Package Management**: CLI and framework distributed through NPM registry

### Runtime Interactions  
- **Server-Side**: Markout runs on Node.js, compiling and pre-rendering pages
- **Client-Side**: Browser receives pre-rendered HTML with embedded reactive runtime
- **Hydration**: Client-side runtime takes over from server-rendered state seamlessly

### Deployment Pipeline
- **CI/CD Integration**: Automated building, testing, and deployment of Markout applications
- **Production**: PM2 process management with clustering and health monitoring

## External Dependencies

- **Node.js 18+**: Required runtime environment with modern JavaScript features
- **Express.js**: Web server framework and middleware system
- **Modern Browsers**: Support for Proxy, ES6+, and standard DOM APIs
- **Build Tools**: esbuild for fast TypeScript compilation and bundling