import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { Server } from '../src/server/server';
import fs from 'fs';
import path from 'path';

describe('Rate Limiting', () => {
  let server: Server;
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary test directory with a simple HTML file
    testDir = path.join(process.cwd(), 'test-temp-' + Date.now());
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(
      path.join(testDir, 'index.html'),
      '<html><body><h1>Test Page</h1></body></html>'
    );
  });

  afterEach(async () => {
    if (server?.server) {
      server.server.close();
      server = undefined as any;
    }
    // Clean up test directory
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Page rate limiting', () => {
    it('should allow requests within rate limit', async () => {
      server = new Server({
        docroot: testDir,
        port: 0, // Let system assign port
        pageLimit: {
          windowMs: 60000, // 1 minute
          maxRequests: 5, // Allow 5 requests per minute
        },
        ssr: false, // Disable SSR for tests
        csr: false, // Disable CSR to avoid client.js requirement
        mute: true, // Suppress logging during tests
      });

      await server.start();
      const app = server.app!;

      // Make first request - should succeed
      const response = await request(app).get('/').expect(200);

      // Check rate limit headers are present
      expect(response.headers).toHaveProperty('ratelimit-limit');
      expect(response.headers).toHaveProperty('ratelimit-remaining');
      expect(response.headers).toHaveProperty('ratelimit-reset');

      // Verify limit value
      expect(response.headers['ratelimit-limit']).toBe('5');
    });

    it('should block requests when rate limit is exceeded', async () => {
      server = new Server({
        docroot: testDir,
        port: 0,
        pageLimit: {
          windowMs: 60000, // 1 minute
          maxRequests: 2, // Allow only 2 requests per minute
        },
        ssr: false,
        csr: false,
        mute: true,
      });

      await server.start();
      const app = server.app!;

      // Make requests up to the limit
      await request(app).get('/').expect(200);
      await request(app).get('/').expect(200);

      // Third request should be rate limited
      const response = await request(app).get('/').expect(429);

      // Check rate limit headers
      expect(response.headers['ratelimit-limit']).toBe('2');
      expect(response.headers['ratelimit-remaining']).toBe('0');
    });

    it('should handle HTML page requests with rate limiting', async () => {
      server = new Server({
        docroot: testDir,
        port: 0,
        pageLimit: {
          windowMs: 60000,
          maxRequests: 3,
        },
        ssr: false,
        csr: false,
        mute: true,
      });

      await server.start();
      const app = server.app!;

      // Test HTML page request
      const response = await request(app).get('/index.html').expect(200);

      // Should include rate limit headers
      expect(response.headers['ratelimit-limit']).toBe('3');
      expect(parseInt(response.headers['ratelimit-remaining'])).toBeLessThan(3);
    });

    it('should work without rate limiting when pageLimit is not set', async () => {
      server = new Server({
        docroot: testDir,
        port: 0,
        ssr: false,
        csr: false,
        mute: true,
      });

      await server.start();
      const app = server.app!;

      const response = await request(app).get('/').expect(200);

      // Should not have rate limit headers when no limit is set
      expect(response.headers).not.toHaveProperty('ratelimit-limit');
    });

    it('should configure rate limiter with custom settings', async () => {
      server = new Server({
        docroot: testDir,
        port: 0,
        pageLimit: {
          windowMs: 30000, // 30 seconds
          maxRequests: 10, // 10 requests per 30 seconds
        },
        ssr: false,
        csr: false,
        mute: true,
      });

      await server.start();
      const app = server.app!;

      const response = await request(app).get('/').expect(200);

      // Verify custom limit is applied
      expect(response.headers['ratelimit-limit']).toBe('10');
    });
  });

  describe('Traffic limiter functionality', () => {
    it('should apply rate limiting to multiple paths', async () => {
      server = new Server({
        docroot: testDir,
        port: 0,
        pageLimit: {
          windowMs: 60000,
          maxRequests: 1, // Very restrictive for testing
        },
        ssr: false,
        csr: false,
        mute: true,
      });

      await server.start();
      const app = server.app!;

      // First request should succeed
      await request(app).get('/').expect(200);

      // Both wildcard and .html paths should be rate limited
      await request(app).get('/index.html').expect(429);
    });
  });
});
