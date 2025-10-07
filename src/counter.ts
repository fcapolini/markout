// Simple client-side component for demonstration
export class Counter {
  private count: number = 0;
  private element: HTMLDivElement;
  private countDisplay: HTMLSpanElement;
  private incrementBtn: HTMLButtonElement;
  private decrementBtn: HTMLButtonElement;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container with id "${containerId}" not found`);
    }

    this.element = document.createElement('div');
    this.element.className = 'counter';

    this.countDisplay = document.createElement('span');
    this.countDisplay.className = 'count-display';
    this.countDisplay.textContent = '0';

    this.incrementBtn = document.createElement('button');
    this.incrementBtn.textContent = '+';
    this.incrementBtn.addEventListener('click', () => this.increment());

    this.decrementBtn = document.createElement('button');
    this.decrementBtn.textContent = '-';
    this.decrementBtn.addEventListener('click', () => this.decrement());

    this.element.appendChild(this.decrementBtn);
    this.element.appendChild(this.countDisplay);
    this.element.appendChild(this.incrementBtn);

    container.appendChild(this.element);
  }

  increment(): void {
    this.count++;
    this.updateDisplay();
  }

  decrement(): void {
    this.count--;
    this.updateDisplay();
  }

  getCount(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
    this.updateDisplay();
  }

  private updateDisplay(): void {
    this.countDisplay.textContent = this.count.toString();

    // Add visual feedback
    this.element.classList.toggle('positive', this.count > 0);
    this.element.classList.toggle('negative', this.count < 0);
    this.element.classList.toggle('zero', this.count === 0);
  }

  destroy(): void {
    this.element.remove();
  }
}
