import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser } from 'happy-dom';
import { Server } from '../../src/server';
import fs from 'fs';
import os from 'os';

/**
 * A classic `function` inside an expression, which the language used to
 * refuse outright.
 *
 * The refusal had one reason and it was an implementation detail: a
 * compiled expression reached its scope through `this`, and a classic
 * function rebinds `this`. It reaches it through a parameter now, captured
 * like any other closure variable, so the rule had nothing left to protect.
 * What this asserts is the part that cannot be read off the compiled props:
 * that such a function, in a browser, sees the scope it was written in.
 */
describe('a classic function in an expression', () => {
  let dir: string;
  let server: Server;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-classic-'));
    fs.writeFileSync(
      path.join(dir, 'i.html'),
      `<html :rows=\${[1, 2]} :factor=\${10}>
        <body>
          <ul><li :for-each=\${rows.map(function (n) { return n * factor; })}>\${data}</li></ul>
          <button :on-click=\${function () { rows = [...rows, rows.length + 1]; }}>add</button>
          <p id="count">\${rows.length}</p>
        </body>
      </html>`
    );
    server = new Server({ docroot: dir });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sees the scope it was written in, server-side and after hydration', async () => {
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const page = browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/i.html`);
      await page.waitUntilComplete();
      const document = page.mainFrame.document;
      const items = () => [...document.querySelectorAll('li')].map(li => li.textContent?.trim());

      // the classic function inside .map() read `factor` from the scope,
      // and the server rendered what it returned
      expect(items()).toEqual(['10', '20']);
      expect(document.querySelector('#count')?.textContent?.trim()).toBe('2');

      // and a classic function as a handler writes back into it
      document
        .querySelector('button')!
        .dispatchEvent(new page.mainFrame.window.MouseEvent('click'));

      expect(items()).toEqual(['10', '20', '30']);
      expect(document.querySelector('#count')?.textContent?.trim()).toBe('3');
    } finally {
      await browser.close();
    }
  });
});
