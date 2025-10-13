# Installing Markout (Alpha)

Markout is currently in alpha development. Here's how to install and use it:

## Prerequisites

- Node.js 18+ (tested on 18.x, 20.x, 22.x, 24.x)
- npm or yarn
- Git

## Installation

### Option 1: Install from npm (Recommended)

```bash
# Install globally
npm install -g @markout-js/cli

# Test the installation
markout --help

# Or use without installing globally
npx @markout-js/cli --help
```

### Option 2: Clone and Build (Development)

```bash
# Clone the repository
git clone https://github.com/fcapolini/markout.git
cd markout

# Install dependencies
npm install

# Build the project
npm run build

# Test the installation
node dist/index.js --help
```

## Quick Start

### 1. Create a Simple Page

Create a file called `hello.html`:

```html
<html>
  <body>
    <h1>Hello Markout!</h1>
    <button :count="${0}" :on-click="${() => count++}">
      Clicks: ${count}
    </button>
  </body>
</html>
```

### 2. Serve the Page

```bash
# Serve the current directory (which contains hello.html)
markout serve .

# Or serve on a different port
markout serve . --port 3000
```

### 3. Open in Browser

Navigate to `http://localhost:3000` to see your reactive page in action!

## Development Scripts

Once you have the project cloned:

```bash
# Development server with hot reload
npm run dev

# Run tests
npm test

# Build for production
npm run build

# Start production server
npm start

# Start with PM2 (production cluster)
npm run start:prod
```

## Alpha Limitations

- **API may change**: Breaking changes possible until v1.0
- **Some features missing**: See [ROADMAP.md](ROADMAP.md) for details
- **Limited examples**: More tutorials and guides coming
- **CLI package size**: 815KB (will be optimized in future releases)

## Getting Help

- **GitHub Issues**: Report bugs and request features
- **Discussions**: Ask questions and share ideas
- **Documentation**: Check README.md and ROADMAP.md

## What's Next?

- v0.2.0 will include npm publication
- More examples and tutorials
- Complete feature implementation
- Improved developer experience

---

*This installation process will be simplified significantly once we publish to npm in v0.2.0*