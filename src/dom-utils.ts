// DOM utility functions for client-side operations

export function createElement(tag: string, className?: string): HTMLElement {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  return element;
}

export function setElementText(element: HTMLElement, text: string): void {
  element.textContent = text;
}

export function addClickListener(
  element: HTMLElement,
  callback: () => void
): void {
  element.addEventListener('click', callback);
}

export function getElementByTestId(testId: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testId}"]`);
}

export function createButton(
  text: string,
  onClick: () => void
): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

export function toggleClass(element: HTMLElement, className: string): void {
  element.classList.toggle(className);
}

export function isElementVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}
