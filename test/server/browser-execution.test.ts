import { execSync } from "child_process";
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser } from "happy-dom";
import { Server } from "../../src/server";
import fs from "fs";
import os from "os";

describe("Browser execution (happy-dom)", () => {
  let tempDir: string;
  let server: Server;

  beforeAll(async () => {
    // guarantee a fresh dist/markout-runtime.js regardless of local state
    execSync('npm run build:runtime', { cwd: path.resolve(__dirname, '../..') });

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "markout-e2e-test-"));
    fs.writeFileSync(
      path.join(tempDir, "counter.html"),
      `<html :count=\${0}>
        <body>
          <button :on-click=\${() => count++}>Clicked \${count} times</button>
        </body>
      </html>`
    );
    fs.writeFileSync(
      path.join(tempDir, "attributes.html"),
      `<html :count=\${0}>
        <body>
          <button :on-click=\${() => count++}
                  data-count=\${count}
                  aria-label=\${'clicked ' + count}
                  title=\${count > 0 ? 'yes' : null}
                  type="button">click</button>
        </body>
      </html>`
    );

    server = new Server({ docroot: tempDir });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should hydrate and react to a real click, entirely inside a happy-dom window', async () => {
    // navigating for real exercises the actual <script async> loading and
    // execution pipeline, rather than manually eval-ing extracted source
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const page = browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/counter.html`);
      await page.waitUntilComplete();

      const document = page.mainFrame.document;
      const button = document.querySelector('button')!;
      expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('Clicked 0 times');

      button.dispatchEvent(new page.mainFrame.window.MouseEvent('click'));
      expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('Clicked 1 times');

      button.dispatchEvent(new page.mainFrame.window.MouseEvent('click'));
      button.dispatchEvent(new page.mainFrame.window.MouseEvent('click'));
      expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('Clicked 3 times');
    } finally {
      await browser.close();
    }
  });

  it('should keep plain attributes with ${} values in sync with their expression', async () => {
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const page = browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/attributes.html`);
      await page.waitUntilComplete();

      const button = page.mainFrame.document.querySelector('button')!;
      // SSR already painted the initial values, so they're right before any
      // client-side refresh has had a chance to run
      expect(button.getAttribute('data-count')).toBe('0');
      expect(button.getAttribute('aria-label')).toBe('clicked 0');
      expect(button.getAttribute('type')).toBe('button');
      // a null value means "no attribute", not the string "null"
      expect(button.hasAttribute('title')).toBe(false);

      button.dispatchEvent(new page.mainFrame.window.MouseEvent('click'));
      expect(button.getAttribute('data-count')).toBe('1');
      expect(button.getAttribute('aria-label')).toBe('clicked 1');
      expect(button.getAttribute('title')).toBe('yes');
      expect(button.getAttribute('type')).toBe('button');
    } finally {
      await browser.close();
    }
  });
});
