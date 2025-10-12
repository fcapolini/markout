import { describe, it, expect } from 'vitest';
import { runPage, createDocument } from './jsdom-util';

describe('JSDOM Utilities', () => {
  it('should run a simple page with server-side rendering', async () => {
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
    const html = `
      <html>
        <body>
          <div :invalid-syntax="">Bad syntax</div>
        </body>
      </html>
    `;

    try {
      await runPage(false, html);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toContain('error:');
    }
  });

  it('should create document from HTML', () => {
    const html = '<div>Hello World</div>';
    const doc = createDocument(html);

    expect(doc).toBeDefined();
    // Cast to any to access JSDOM-specific properties
    const jsdomDoc = doc as any;
    expect(jsdomDoc.body).toBeDefined();
    expect(jsdomDoc.body.innerHTML).toContain('Hello World');
  });

  it('should create document with complex HTML structure', () => {
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
    const jsdomDoc = doc as any;

    expect(jsdomDoc.title).toBe('Test');
    expect(jsdomDoc.querySelector('h1')?.textContent).toBe('Title');
    expect(jsdomDoc.querySelector('p')?.textContent).toBe('Paragraph');
    expect(jsdomDoc.querySelector('.container')).toBeDefined();
  });
});
