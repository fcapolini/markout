import { describe, it, expect, beforeEach } from 'vitest';
import {
  createElement,
  setElementText,
  addClickListener,
  getElementByTestId,
  createButton,
  toggleClass,
  isElementVisible,
} from '../src/dom-utils';

describe('DOM Utilities', () => {
  beforeEach(() => {
    // Clear the document body before each test
    document.body.innerHTML = '';
  });

  describe('createElement', () => {
    it('should create an element with the specified tag', () => {
      const div = createElement('div');
      expect(div.tagName).toBe('DIV');
    });

    it('should create an element with a class name', () => {
      const div = createElement('div', 'test-class');
      expect(div.className).toBe('test-class');
    });
  });

  describe('setElementText', () => {
    it('should set the text content of an element', () => {
      const div = createElement('div');
      setElementText(div, 'Hello World');
      expect(div.textContent).toBe('Hello World');
    });
  });

  describe('addClickListener', () => {
    it('should add a click event listener', () => {
      const button = createElement('button');
      let clicked = false;

      addClickListener(button, () => {
        clicked = true;
      });

      button.click();
      expect(clicked).toBe(true);
    });
  });

  describe('getElementByTestId', () => {
    it('should find element by test id', () => {
      const div = createElement('div');
      div.setAttribute('data-testid', 'test-element');
      document.body.appendChild(div);

      const found = getElementByTestId('test-element');
      expect(found).toBe(div);
    });

    it('should return null for non-existent test id', () => {
      const found = getElementByTestId('non-existent');
      expect(found).toBeNull();
    });
  });

  describe('createButton', () => {
    it('should create a button with text and click handler', () => {
      let clickCount = 0;
      const button = createButton('Click me', () => {
        clickCount++;
      });

      expect(button.tagName).toBe('BUTTON');
      expect(button.textContent).toBe('Click me');

      button.click();
      expect(clickCount).toBe(1);
    });
  });

  describe('toggleClass', () => {
    it('should toggle a class on an element', () => {
      const div = createElement('div');

      toggleClass(div, 'active');
      expect(div.classList.contains('active')).toBe(true);

      toggleClass(div, 'active');
      expect(div.classList.contains('active')).toBe(false);
    });
  });

  describe('isElementVisible', () => {
    it('should return true for visible elements', () => {
      const div = createElement('div');
      document.body.appendChild(div);

      expect(isElementVisible(div)).toBe(true);
    });

    it('should return false for hidden elements', () => {
      const div = createElement('div');
      div.style.display = 'none';
      document.body.appendChild(div);

      expect(isElementVisible(div)).toBe(false);
    });
  });
});
