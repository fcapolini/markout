# TypeScript Express.js Project

This is a TypeScript Node.js + Express.js project with nodemon for development and resilient production execution.

## Project Structure

- TypeScript source files in `src/` directory
- Compiled JavaScript output in `dist/` directory
- Express.js server with basic routes
- Nodemon for auto-restart functionality
- Test files in `tests/` directory with dual environment support

## Available Scripts

- `npm run dev` - Development server with hot reload (TypeScript)
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Production server (single run)
- `npm run start:prod` - Production server with auto-restart on crashes
- `npm run start:prod` - Production server with PM2 (cluster mode)
- `npm run stop` - Stop PM2 processes
- `npm run restart` - Restart PM2 processes
- `npm run reload` - Graceful reload PM2 processes (zero downtime)
- `npm run logs` - View PM2 logs
- `npm run monit` - Open PM2 monitoring dashboard
- `npm run watch` - Watch TypeScript files and rebuild
- `npm run clean` - Clean the dist directory
- `npm test` - Run tests in watch mode
- `npm run test:run` - Run tests once
- `npm run test:coverage` - Run tests with coverage report
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check if code is formatted

## Development Guidelines

- Use TypeScript for all source code
- Follow Express.js best practices
- Nodemon handles automatic restarts in development
- PM2 handles production process management with clustering
- Build before deploying to production
- Use `npm run start:prod` for production deployment with PM2
- Use `npm run reload` for zero-downtime deployments
- Write tests for new features using Vitest
- Run tests before committing changes
- Use Prettier for consistent code formatting
- Run `npm run format` before committing

## API Endpoints

- `GET /` - Hello World message
- `GET /health` - Health check endpoint
- `POST /api/sensitive` - Example endpoint with stricter rate limiting
- `GET /api/rate-limit-status` - Check current rate limit status

## Testing Framework

- **Vitest** - Fast unit test framework with TypeScript support
- **Supertest** - HTTP assertion library for API testing
- **jsdom** - DOM environment for client-side testing
- **Coverage reports** - V8 coverage provider with HTML/JSON output
- Test files located in `tests/` directory
- Automatic environment selection (Node.js vs jsdom based on file naming)

## Testing Environment Selection

Files are automatically assigned to the appropriate test environment:

- `*.dom.test.ts` files run in **jsdom** environment for DOM/client-side testing
- Files in `tests/dom/` or `tests/client/` directories run in **jsdom** environment
- All other test files run in **Node.js** environment for server-side testing

## Example Components

- `src/utils.ts` - Basic utility functions (math, string operations)
- `src/dom-utils.ts` - DOM manipulation utilities for client-side code
- `src/counter.ts` - Example client-side component with DOM interaction
- `src/index.ts` - Main Express server application

## Test Examples

- `tests/utils.test.ts` - Unit tests for utility functions
- `tests/api.test.ts` - Integration tests for API endpoints
- `tests/rate-limit.test.ts` - Rate limiting functionality tests
- `tests/dom-utils.dom.test.ts` - DOM utility function tests
- `tests/counter.dom.test.ts` - Client-side component tests

## Production Features

- **PM2 Process Manager** - Cluster mode, zero-downtime deployments, crash recovery
- **Health Monitoring** - HTTP endpoint health checks and automatic restarts
- **Load Balancing** - Built-in load balancer across CPU cores
- **Logging** - Centralized logging with log rotation and monitoring
- **Memory Management** - Automatic restart on memory leaks (1GB limit)

## Security Features

- **Rate Limiting** - express-rate-limit for API protection and DoS prevention
- **Request throttling** - Different limits for general and sensitive endpoints
- **Standard headers** - Rate limit information in response headers

Project is ready for development and production use with comprehensive testing, security features, and enterprise-grade process management.
