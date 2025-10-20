import { describe, it, expect } from 'vitest';

// Happy DOM is compatible with all Node.js versions that Markout supports
// No version-specific skipping needed with Happy DOM

describe('DOM Utilities', () => {
  it('should run a simple page with server-side rendering', async () => {
    // Dynamic import to avoid loading Happy DOM unnecessarily
    const { runPage } = await import('./dom-util');

    const html = `
      <html>
        <body>
          <div :count="${0}">Count: \${count}</div>
        </body>
      </html>
    `;

    const ctx = await runPage(false, html);

    expect(ctx).toBeDefined();
    expect(ctx.root).toBeDefined();
  });

  it('should run a page with client-side hydration', async () => {
    // Dynamic import to avoid loading Happy DOM unnecessarily
    const { runPage } = await import('./dom-util');

    const html = `
      <html>
        <body>
          <button :count="\${0}">Clicks: \${count}</button>
        </body>
      </html>
    `;

    const ctx = await runPage(true, html);

    expect(ctx).toBeDefined();
    expect(ctx.root).toBeDefined();
  });

  it('should handle compilation errors gracefully', async () => {
    // Dynamic import to avoid loading Happy DOM unnecessarily
    const { runPage } = await import('./dom-util');

    const html = `
      <html>
        <body>
          <div :onclick="${(e: any) => {
            const invalid$ = 'test';
          }}">Bad syntax</div>
        </body>
      </html>
    `;

    try {
      await runPage(false, html);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect((error as Error).message).toContain('error:');
    }
  });

  it('should create document from HTML', async () => {
    // Dynamic import to avoid loading Happy DOM unnecessarily
    const { createDocument } = await import('./dom-util');

    const html = '<div>Hello World</div>';
    const doc = createDocument(html);

    expect(doc).toBeDefined();
    // Cast to any to access DOM-specific properties
    const domDoc = doc as any;
    expect(domDoc.body).toBeDefined();
    expect(domDoc.body.innerHTML).toContain('Hello World');
  });

  it('should create document with complex HTML structure', async () => {
    // Dynamic import to avoid loading Happy DOM unnecessarily
    const { createDocument } = await import('./dom-util');

    const html = `
      <html>
        <head><title>Test</title></head>
        <body>
          <div class="container">
            <h1>Title</h1>
            <p>Paragraph</p>
          </div>
        </body>
      </html>
    `;

    const doc = createDocument(html);
    const domDoc = doc as any;

    expect(domDoc.title).toBe('Test');
    expect(domDoc.querySelector('h1')?.textContent).toBe('Title');
    expect(domDoc.querySelector('p')?.textContent).toBe('Paragraph');
    expect(domDoc.querySelector('.container')).toBeDefined();
  });
});
