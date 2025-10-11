import { describe, it, expect } from 'vitest';
import request from 'supertest';
// import app from '../src/index';

describe.skip('Rate Limiting', () => {
  // describe('General rate limiting', () => {
  //   it('should allow requests within rate limit', async () => {
  //     const response = await request(app)
  //       .get('/api/rate-limit-status')
  //       .expect(200);

  //     expect(response.body).toHaveProperty('message', 'Rate limit status');
  //     expect(response.body).toHaveProperty('headers');
  //     expect(response.headers).toHaveProperty('ratelimit-limit');
  //     expect(response.headers).toHaveProperty('ratelimit-remaining');
  //   });

  //   it('should include rate limit headers in response', async () => {
  //     const response = await request(app).get('/').expect(200);

  //     expect(response.headers).toHaveProperty('ratelimit-limit', '100');
  //     expect(response.headers).toHaveProperty('ratelimit-remaining');
  //     expect(response.headers).toHaveProperty('ratelimit-reset');
  //   });
  // });

  // describe('Sensitive endpoint rate limiting', () => {
  //   it('should allow POST to sensitive endpoint', async () => {
  //     const response = await request(app).post('/api/sensitive').expect(200);

  //     expect(response.body).toHaveProperty(
  //       'message',
  //       'This is a sensitive endpoint with stricter rate limiting'
  //     );
  //     expect(response.headers).toHaveProperty('ratelimit-limit', '5');
  //   });

  //   it('should include stricter rate limit headers for sensitive endpoint', async () => {
  //     const response = await request(app).post('/api/sensitive').expect(200);

  //     expect(response.headers).toHaveProperty('ratelimit-limit', '5');
  //     expect(response.headers).toHaveProperty('ratelimit-remaining');
  //   });
  // });

  // describe('Rate limit status endpoint', () => {
  //   it('should return rate limit information', async () => {
  //     const response = await request(app)
  //       .get('/api/rate-limit-status')
  //       .expect(200);

  //     expect(response.body.message).toBe('Rate limit status');
  //     expect(response.body.headers).toBeDefined();
  //     expect(typeof response.body.headers['rateLimit-limit']).toBe('string');
  //     expect(typeof response.body.headers['rateLimit-remaining']).toBe(
  //       'string'
  //     );
  //   });
  // });
});
