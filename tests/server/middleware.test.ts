import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { markout, CLIENT_CODE_REQ } from '../../src/server/middleware';
import fs from 'fs';

// Mock fs and path modules
vi.mock('fs', () => ({
  default: {
    promises: {
      stat: vi.fn(),
    },
    readFileSync: vi.fn(),
  },
}));

vi.mock('path', () => ({
  default: {
    join: vi.fn((...args: string[]) => args.join('/')),
    lastIndexOf: vi.fn(),
  },
}));

describe('Markout Middleware', () => {
  const createMockRequest = (path: string): Request =>
    ({
      path,
    }) as Request;

  const createMockResponse = (): Response =>
    ({
      header: vi.fn().mockReturnThis(),
      send: vi.fn(),
      sendStatus: vi.fn(),
    }) as any;

  const mockNext: NextFunction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    const mockFs = vi.mocked(fs);
    mockFs.readFileSync.mockReturnValue('/* client code */');
  });

  it('should serve client code when requested', async () => {
    const req = createMockRequest(CLIENT_CODE_REQ);
    const res = createMockResponse();

    const middleware = markout({
      docroot: '/test',
      csr: true,
    });

    await middleware(req, res, mockNext);

    expect(res.header).toHaveBeenCalledWith(
      'Content-Type',
      'text/javascript;charset=UTF-8'
    );
    expect(res.send).toHaveBeenCalledWith('/* client code */');
  });

  it('should return 404 for dot-prefixed paths', async () => {
    const req = createMockRequest('/.hidden');
    const res = createMockResponse();

    const middleware = markout({
      docroot: '/test',
    });

    await middleware(req, res, mockNext);

    expect(res.sendStatus).toHaveBeenCalledWith(404);
  });

  it('should return 404 for .htm files', async () => {
    const req = createMockRequest('/page.htm');
    const res = createMockResponse();

    const middleware = markout({
      docroot: '/test',
    });

    await middleware(req, res, mockNext);

    expect(res.sendStatus).toHaveBeenCalledWith(404);
  });

  it('should call next() for non-HTML files', async () => {
    const req = createMockRequest('/style.css');
    const res = createMockResponse();

    const middleware = markout({
      docroot: '/test',
    });

    await middleware(req, res, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should handle middleware creation with minimal props', () => {
    const middleware = markout({
      docroot: '/test',
    });

    expect(middleware).toBeInstanceOf(Function);
  });

  it('should handle middleware creation with full props', () => {
    const mockLogger = vi.fn();

    const middleware = markout({
      docroot: '/test',
      ssr: true,
      csr: true,
      logger: mockLogger,
      clientCodePath: '/custom/client.js',
    });

    expect(middleware).toBeInstanceOf(Function);
  });

  it('should handle CSR disabled (no client code)', async () => {
    const req = createMockRequest(CLIENT_CODE_REQ);
    const res = createMockResponse();

    const middleware = markout({
      docroot: '/test',
      csr: false,
    });

    await middleware(req, res, mockNext);

    expect(res.send).toHaveBeenCalledWith('');
  });
});
