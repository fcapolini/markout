import { describe, it, expect } from 'vitest';
import { runPage } from '../dom-util';

describe('Unquoted Expression Syntax', () => {
  it('should allow both double and single quotes in string literals without escaping', async () => {
    const html = `
      <html>
        <head></head>
        <body>
          <div :message1=\${'String with "double" quotes'}
               :message2=\${"String with 'single' quotes"}
               :combined=\${'Mixed: "double" and \\'single\\' quotes'}>
            <span id="message1">\${message1}</span>
            <span id="message2">\${message2}</span>
            <span id="combined">\${combined}</span>
          </div>
        </body>
      </html>
    `;

    const ctx = await runPage(true, html);
    const doc = (ctx.props as any).doc;

    expect(doc.querySelector('#message1')?.textContent).toBe(
      'String with "double" quotes'
    );
    expect(doc.querySelector('#message2')?.textContent).toBe(
      "String with 'single' quotes"
    );
    expect(doc.querySelector('#combined')?.textContent).toBe(
      'Mixed: "double" and \'single\' quotes'
    );
  });

  it('should support template literals in unquoted expressions', async () => {
    const html = `
      <html>
        <head></head>
        <body>
          <div :person=\${'World'}
               :greeting=\${\`Hello, \${person}! Welcome to "Markout" framework.\`}>
            <span id="greeting">\${greeting}</span>
          </div>
        </body>
      </html>
    `;

    const ctx = await runPage(true, html);
    const doc = (ctx.props as any).doc;

    expect(doc.querySelector('#greeting')?.textContent).toBe(
      'Hello, World! Welcome to "Markout" framework.'
    );
  });

  it('should handle complex expressions with mixed quote styles', async () => {
    const html = `
      <html>
        <head></head>
        <body>
          <div :config=\${{ 
                 title: "App Title", 
                 subtitle: 'App Subtitle',
                 description: \`Multi-line description with "quotes" and 'apostrophes'\`
               }}
               :status=\${config.title ? 'loaded' : "loading"}>
            <span id="title">\${config.title}</span>
            <span id="subtitle">\${config.subtitle}</span>
            <span id="status">\${status}</span>
          </div>
        </body>
      </html>
    `;

    const ctx = await runPage(true, html);
    const doc = (ctx.props as any).doc;

    expect(doc.querySelector('#title')?.textContent).toBe('App Title');
    expect(doc.querySelector('#subtitle')?.textContent).toBe('App Subtitle');
    expect(doc.querySelector('#status')?.textContent).toBe('loaded');
  });
});
