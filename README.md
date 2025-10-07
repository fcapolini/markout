# TypeScript Express Project

A simple TypeScript Node.js Express.js project.

## Getting Started

### Prerequisites

- Node.js (version 14 or higher)
- npm or yarn

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

### Development

1. Start the development server:

   ```bash
   npm run dev
   ```

2. Build the project:

   ```bash
   npm run build
   ```

3. Start the production server:
   ```bash
   npm start
   ```

### Available Scripts

#### Development

- `npm run dev` - Start development server with hot reload (nodemon + ts-node)
- `npm run build` - Build the TypeScript project
- `npm run watch` - Watch for changes and rebuild
- `npm run clean` - Clean the dist directory

#### Production (PM2)

- `npm run start:prod` - Start production server with PM2 (cluster mode)
- `npm run start:dev` - Start development server with PM2
- `npm run stop` - Stop PM2 processes
- `npm run restart` - Restart PM2 processes
- `npm run reload` - Graceful reload PM2 processes (zero downtime)
- `npm run delete` - Delete PM2 processes
- `npm run logs` - View PM2 logs
- `npm run monit` - Open PM2 monitoring dashboard

#### Testing

- `npm test` - Run tests in watch mode
- `npm run test:run` - Run tests once
- `npm run test:coverage` - Run tests with coverage report

#### Code Quality

- `npm run format` - Format code with Prettier
- `npm run format:check` - Check if code is formatted

#### Basic

- `npm start` - Start single Node.js process (not recommended for production)

### API Endpoints

- `GET /` - Hello World message
- `GET /health` - Health check endpoint
- `POST /api/sensitive` - Example endpoint with stricter rate limiting
- `GET /api/rate-limit-status` - Check current rate limit status

The server runs on port 3000 by default (configurable via environment variables).

## Security Features

### Rate Limiting

This application includes **express-rate-limit** for API protection:

- **General rate limit**: 100 requests per 15-minute window per IP
- **Sensitive endpoints**: 5 requests per 15-minute window per IP
- **Standard headers**: Returns rate limit info in `RateLimit-*` headers
- **Custom error messages**: User-friendly rate limit exceeded messages

Rate limiting helps protect against:

- **DoS attacks** - Prevents overwhelming the server
- **Brute force attacks** - Limits login/sensitive endpoint attempts
- **API abuse** - Controls excessive usage

## Production Deployment

This project uses **PM2** for production process management, offering:

### PM2 Features

- **Cluster mode** - Utilizes all CPU cores for better performance
- **Zero-downtime deployment** - Graceful reloads without service interruption
- **Automatic restarts** - Process monitoring and crash recovery
- **Load balancing** - Built-in load balancer across worker processes
- **Memory monitoring** - Automatic restart on memory leaks (1GB limit)
- **Health checks** - HTTP endpoint monitoring for process health
- **Log management** - Centralized logging with rotation
- **Process monitoring** - Real-time performance metrics

### Production Workflow

1. **Build**: `npm run build`
2. **Start**: `npm run start:prod`
3. **Monitor**: `npm run logs` or `npm run monit`
4. **Deploy updates**: `npm run reload` (zero downtime)

### Environment Configuration

- **Development**: NODE_ENV=development
- **Production**: NODE_ENV=production
- **Port**: Configurable via PORT environment variable

## Testing

This project uses [Vitest](https://vitest.dev/) for testing with support for both **Node.js** and **DOM environments**:

- **Unit tests** for utility functions (`tests/utils.test.ts`)
- **API tests** for Express endpoints (`tests/api.test.ts`)
- **DOM tests** for client-side components (`tests/*.dom.test.ts`)
- **Coverage reporting** with V8 provider
- **Watch mode** for development

### Test Environments

- **Node.js environment** - Default for server-side testing
- **jsdom environment** - Automatically used for DOM tests (files matching `*.dom.test.ts`)

### Test Structure

- `tests/` - Test files directory
- `tests/utils.test.ts` - Unit tests for utility functions
- `tests/api.test.ts` - Integration tests for API endpoints
- `tests/dom-utils.dom.test.ts` - DOM utility function tests
- `tests/counter.dom.test.ts` - Client-side component tests

### Environment Selection

Files are automatically assigned to the appropriate test environment:

- `*.dom.test.ts` files run in **jsdom** environment
- All other test files run in **Node.js** environment

Run `npm test` to start testing in watch mode, or `npm run test:run` for a single test run.

## Code Formatting

This project uses **Prettier** for consistent code formatting across all files:

### Prettier Configuration

- **Semi-colons**: Always used
- **Quotes**: Single quotes for strings
- **Trailing commas**: ES5 compatible
- **Print width**: 80 characters
- **Tab width**: 2 spaces
- **Arrow parens**: Avoid when possible

### Usage

- **Format all files**: `npm run format`
- **Check formatting**: `npm run format:check`

### Pre-commit Workflow

1. Write your code
2. Run `npm run format` to format
3. Run `npm run test:run` to test
4. Commit your changes

All files are automatically formatted to maintain consistent code style.
