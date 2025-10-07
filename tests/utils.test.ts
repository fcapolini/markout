import { describe, it, expect } from 'vitest';
import { add, multiply, isEven, capitalize } from '../src/utils';

describe('Math utilities', () => {
  it('should add two numbers correctly', () => {
    expect(add(2, 3)).toBe(5);
    expect(add(-1, 1)).toBe(0);
    expect(add(0, 0)).toBe(0);
  });

  it('should multiply two numbers correctly', () => {
    expect(multiply(3, 4)).toBe(12);
    expect(multiply(-2, 5)).toBe(-10);
    expect(multiply(0, 100)).toBe(0);
  });

  it('should check if number is even', () => {
    expect(isEven(2)).toBe(true);
    expect(isEven(3)).toBe(false);
    expect(isEven(0)).toBe(true);
    expect(isEven(-4)).toBe(true);
  });
});

describe('String utilities', () => {
  it('should capitalize strings correctly', () => {
    expect(capitalize('hello')).toBe('Hello');
    expect(capitalize('WORLD')).toBe('World');
    expect(capitalize('tESt')).toBe('Test');
    expect(capitalize('')).toBe('');
  });
});
