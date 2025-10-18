import { describe, it, expect } from 'vitest';
import { runPage } from '../jsdom-util';

describe('Expression Interpolation Integration', () => {
  it('should preserve types for single expressions and convert interpolated expressions to strings', async () => {
    const html = `
      <html>
        <head></head>
        <body>
          <div :count="\${42}" 
               :flag="\${true}" 
               :text="\${'test'}"
               :countText="Count: \${count}"
               :flagText="Flag: \${flag}"
               :greeting="Hello \${text}!">
            <!-- Test that single expressions preserve their types -->
            <span id="count-value">\${typeof count} - \${count}</span>
            <span id="flag-value">\${typeof flag} - \${flag}</span>
            <span id="text-value">\${typeof text} - \${text}</span>
            
            <!-- Test that interpolated expressions become strings -->
            <span id="count-text-value">\${typeof countText} - \${countText}</span>
            <span id="flag-text-value">\${typeof flagText} - \${flagText}</span>
            <span id="greeting-value">\${typeof greeting} - \${greeting}</span>
          </div>
        </body>
      </html>
    `;

    const ctx = await runPage(true, html);
    const doc = (ctx.props as any).doc;

    // Single expressions should preserve their original types
    expect(doc.querySelector('#count-value')?.textContent).toBe('number - 42');
    expect(doc.querySelector('#flag-value')?.textContent).toBe(
      'boolean - true'
    );
    expect(doc.querySelector('#text-value')?.textContent).toBe('string - test');

    // Interpolated expressions should become strings
    expect(doc.querySelector('#count-text-value')?.textContent).toBe(
      'string - Count: 42'
    );
    expect(doc.querySelector('#flag-text-value')?.textContent).toBe(
      'string - Flag: true'
    );
    expect(doc.querySelector('#greeting-value')?.textContent).toBe(
      'string - Hello test!'
    );
  });

  it('should handle complex interpolated expressions with multiple variables', async () => {
    const html = `
      <html>
        <head></head>
        <body>
          <div :user="\${{ name: 'John', age: 30, active: true }}"
               :summary="User \${user.name} is \${user.age} years old and is \${user.active ? 'active' : 'inactive'}">
            <span id="user-type">\${typeof user}</span>
            <span id="summary-type">\${typeof summary}</span>
            <span id="summary-value">\${summary}</span>
          </div>
        </body>
      </html>
    `;

    const ctx = await runPage(true, html);
    const doc = (ctx.props as any).doc;

    // Object should preserve its type
    expect(doc.querySelector('#user-type')?.textContent).toBe('object');

    // Complex interpolated expression should be a string
    expect(doc.querySelector('#summary-type')?.textContent).toBe('string');
    expect(doc.querySelector('#summary-value')?.textContent).toBe(
      'User John is 30 years old and is active'
    );
  });

  it('should handle nested expressions in interpolated strings', async () => {
    const html = `
      <html>
        <head></head>
        <body>
          <div :items="\${[1, 2, 3]}"
               :itemCount="\${items.length}"
               :message="You have \${items.length} item\${items.length === 1 ? '' : 's'}: \${items.join(', ')}">
            <span id="items-type">\${typeof items}</span>
            <span id="count-type">\${typeof itemCount}</span>
            <span id="message-type">\${typeof message}</span>
            <span id="message-value">\${message}</span>
          </div>
        </body>
      </html>
    `;

    const ctx = await runPage(true, html);
    const doc = (ctx.props as any).doc;

    // Array should preserve its type
    expect(doc.querySelector('#items-type')?.textContent).toBe('object');

    // Single expression should preserve number type
    expect(doc.querySelector('#count-type')?.textContent).toBe('number');

    // Complex interpolated expression should be a string
    expect(doc.querySelector('#message-type')?.textContent).toBe('string');
    expect(doc.querySelector('#message-value')?.textContent).toBe(
      'You have 3 items: 1, 2, 3'
    );
  });
});
