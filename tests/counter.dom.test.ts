import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Counter } from '../src/counter';

describe('Counter Component', () => {
  let container: HTMLDivElement;
  let counter: Counter;

  beforeEach(() => {
    // Create a container for each test
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Clean up after each test
    if (counter) {
      counter.destroy();
    }
    container.remove();
  });

  describe('initialization', () => {
    it('should create counter with initial count of 0', () => {
      counter = new Counter('test-container');
      expect(counter.getCount()).toBe(0);
    });

    it('should throw error if container not found', () => {
      expect(() => {
        counter = new Counter('non-existent-container');
      }).toThrow('Container with id "non-existent-container" not found');
    });

    it('should create DOM elements correctly', () => {
      counter = new Counter('test-container');

      const counterElement = container.querySelector('.counter');
      expect(counterElement).toBeTruthy();

      const display = counterElement?.querySelector('.count-display');
      expect(display?.textContent).toBe('0');

      const buttons = counterElement?.querySelectorAll('button');
      expect(buttons?.length).toBe(2);
    });
  });

  describe('increment functionality', () => {
    beforeEach(() => {
      counter = new Counter('test-container');
    });

    it('should increment count when increment button clicked', () => {
      const incrementBtn = container.querySelector(
        'button:last-child'
      ) as HTMLButtonElement;

      incrementBtn.click();
      expect(counter.getCount()).toBe(1);

      incrementBtn.click();
      expect(counter.getCount()).toBe(2);
    });

    it('should update display when incremented', () => {
      const incrementBtn = container.querySelector(
        'button:last-child'
      ) as HTMLButtonElement;
      const display = container.querySelector(
        '.count-display'
      ) as HTMLSpanElement;

      incrementBtn.click();
      expect(display.textContent).toBe('1');
    });

    it('should add positive class for positive numbers', () => {
      const incrementBtn = container.querySelector(
        'button:last-child'
      ) as HTMLButtonElement;
      const counterElement = container.querySelector(
        '.counter'
      ) as HTMLDivElement;

      incrementBtn.click();
      expect(counterElement.classList.contains('positive')).toBe(true);
      expect(counterElement.classList.contains('zero')).toBe(false);
    });
  });

  describe('decrement functionality', () => {
    beforeEach(() => {
      counter = new Counter('test-container');
    });

    it('should decrement count when decrement button clicked', () => {
      const decrementBtn = container.querySelector(
        'button:first-child'
      ) as HTMLButtonElement;

      decrementBtn.click();
      expect(counter.getCount()).toBe(-1);

      decrementBtn.click();
      expect(counter.getCount()).toBe(-2);
    });

    it('should add negative class for negative numbers', () => {
      const decrementBtn = container.querySelector(
        'button:first-child'
      ) as HTMLButtonElement;
      const counterElement = container.querySelector(
        '.counter'
      ) as HTMLDivElement;

      decrementBtn.click();
      expect(counterElement.classList.contains('negative')).toBe(true);
      expect(counterElement.classList.contains('zero')).toBe(false);
    });
  });

  describe('reset functionality', () => {
    beforeEach(() => {
      counter = new Counter('test-container');
    });

    it('should reset count to zero', () => {
      const incrementBtn = container.querySelector(
        'button:last-child'
      ) as HTMLButtonElement;

      // Increment a few times
      incrementBtn.click();
      incrementBtn.click();
      expect(counter.getCount()).toBe(2);

      // Reset
      counter.reset();
      expect(counter.getCount()).toBe(0);
    });

    it('should update display and classes when reset', () => {
      const incrementBtn = container.querySelector(
        'button:last-child'
      ) as HTMLButtonElement;
      const display = container.querySelector(
        '.count-display'
      ) as HTMLSpanElement;
      const counterElement = container.querySelector(
        '.counter'
      ) as HTMLDivElement;

      // Increment to positive
      incrementBtn.click();
      expect(counterElement.classList.contains('positive')).toBe(true);

      // Reset
      counter.reset();
      expect(display.textContent).toBe('0');
      expect(counterElement.classList.contains('zero')).toBe(true);
      expect(counterElement.classList.contains('positive')).toBe(false);
    });
  });

  describe('complex interactions', () => {
    beforeEach(() => {
      counter = new Counter('test-container');
    });

    it('should handle mixed increment/decrement operations', () => {
      const incrementBtn = container.querySelector(
        'button:last-child'
      ) as HTMLButtonElement;
      const decrementBtn = container.querySelector(
        'button:first-child'
      ) as HTMLButtonElement;

      incrementBtn.click(); // 1
      incrementBtn.click(); // 2
      decrementBtn.click(); // 1
      decrementBtn.click(); // 0
      decrementBtn.click(); // -1

      expect(counter.getCount()).toBe(-1);
    });
  });
});
