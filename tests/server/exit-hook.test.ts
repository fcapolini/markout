import { describe, it, expect, vi } from 'vitest';

// Mock process methods at module level
const mockProcessOnce = vi.fn();
const mockProcessOn = vi.fn();
const mockProcessExit = vi.fn();

vi.mock('node:process', () => ({
  default: {
    once: mockProcessOnce,
    on: mockProcessOn,
    exit: mockProcessExit,
  },
}));

describe('Exit Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessOnce.mockReturnValue(process);
    mockProcessOn.mockReturnValue(process);
  });

  it('should register callback and return unregister function', async () => {
    const { default: exitHook } = await import('../../src/server/exit-hook');

    const callback = vi.fn();
    const unregister = exitHook(callback);

    expect(typeof unregister).toBe('function');
    expect(mockProcessOnce).toHaveBeenCalledWith('exit', expect.any(Function));
    expect(mockProcessOnce).toHaveBeenCalledWith(
      'SIGINT',
      expect.any(Function)
    );
    expect(mockProcessOnce).toHaveBeenCalledWith(
      'SIGTERM',
      expect.any(Function)
    );
    expect(mockProcessOn).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('should allow unregistering callbacks', async () => {
    const { default: exitHook } = await import('../../src/server/exit-hook');

    const callback = vi.fn();
    const unregister = exitHook(callback);

    expect(typeof unregister).toBe('function');

    // Test that unregister function exists and can be called
    unregister();
  });
});
