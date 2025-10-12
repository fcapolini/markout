import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defaultLogger } from '../../src/server/logger';

describe('Logger', () => {
  // Mock console methods
  let consoleMocks: {
    error: any;
    warn: any;
    info: any;
    debug: any;
    log: any;
  };

  beforeEach(() => {
    consoleMocks = {
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should log error messages', () => {
    defaultLogger('error', 'test error message');

    expect(consoleMocks.error).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      'error',
      'test error message'
    );
  });

  it('should log warn messages', () => {
    defaultLogger('warn', 'test warning');

    expect(consoleMocks.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      'warn',
      'test warning'
    );
  });

  it('should log info messages', () => {
    defaultLogger('info', 'test info');

    expect(consoleMocks.info).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      'info',
      'test info'
    );
  });

  it('should log debug messages', () => {
    defaultLogger('debug', 'test debug');

    expect(consoleMocks.debug).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      'debug',
      'test debug'
    );
  });

  it('should log unknown message types to console.log', () => {
    // @ts-expect-error Testing invalid type
    defaultLogger('unknown', 'test unknown');

    expect(consoleMocks.log).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      'unknown',
      'test unknown'
    );
  });

  it('should handle object messages', () => {
    const testObj = { key: 'value', number: 42 };
    defaultLogger('info', testObj);

    expect(consoleMocks.info).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      'info',
      testObj
    );
  });

  it('should format timestamp correctly', () => {
    defaultLogger('info', 'timestamp test');

    // Just check that timestamp follows the expected format
    expect(consoleMocks.info).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      'info',
      'timestamp test'
    );
  });
});
