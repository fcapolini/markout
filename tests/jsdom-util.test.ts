import { describe, it, expect } from 'vitest';

// Check Node.js version for JSDOM compatibility
// JSDOM has webidl-conversions dependency issues on Node.js 18
// Tests will skip gracefully on Node.js 18 while running normally on Node.js 20+
const nodeVersion = Number.parseInt(process.version.split('.')[0].slice(1));
const isNode18 = nodeVersion === 18;

describe('JSDOM Utilities', () => {
  it('should run a simple page with server-side rendering', async () => {
    if (isNode18) {
      console.warn(
        'Skipping JSDOM test on Node.js 18 due to webidl-conversions compatibility issue'
      );
      return;
    }

    // Dynamic import to avoid loading JSDOM on Node.js 18
    const { runPage } = await import('./jsdom-util');

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
    if (isNode18) {
      console.warn(
        'Skipping JSDOM test on Node.js 18 due to webidl-conversions compatibility issue'
      );
      return;
    }

    // Dynamic import to avoid loading JSDOM on Node.js 18
    const { runPage } = await import('./jsdom-util');

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
    if (isNode18) {
      console.warn(
        'Skipping JSDOM test on Node.js 18 due to webidl-conversions compatibility issue'
      );
      return;
    }

    // Dynamic import to avoid loading JSDOM on Node.js 18
    const { runPage } = await import('./jsdom-util');

    const html = `
      <html>
        <body>
          <div :onclick="${e => {
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
    if (isNode18) {
      console.warn(
        'Skipping JSDOM test on Node.js 18 due to webidl-conversions compatibility issue'
      );
      return;
    }

    // Dynamic import to avoid loading JSDOM on Node.js 18
    const { createDocument } = await import('./jsdom-util');

    const html = '<div>Hello World</div>';
    const doc = createDocument(html);

    expect(doc).toBeDefined();
    // Cast to any to access JSDOM-specific properties
    const jsdomDoc = doc as any;
    expect(jsdomDoc.body).toBeDefined();
    expect(jsdomDoc.body.innerHTML).toContain('Hello World');
  });

  it('should create document with complex HTML structure', async () => {
    if (isNode18) {
      console.warn(
        'Skipping JSDOM test on Node.js 18 due to webidl-conversions compatibility issue'
      );
      return;
    }

    // Dynamic import to avoid loading JSDOM on Node.js 18
    const { createDocument } = await import('./jsdom-util');

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
