import { Application } from "express";
import { execSync } from "child_process";
import path from 'path';
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import { Server } from "../../src/server";
import fs from "fs";
import os from "os";

describe("Browser execution (happy-dom)", () => {
  let tempDir: string;
  let server: Server;
  let app: Application;

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

    server = new Server({ docroot: tempDir });
    await server.start();
    app = server.app!;
  });

  afterAll(async () => {
    await server.stop();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should hydrate and react to a real click, entirely inside a happy-dom window', async () => {
    const page = await request(app).get('/counter.html');
    const runtime = await request(app).get('/.markout.js');
    expect(runtime.text.length).toBeGreaterThan(0);

    const propsScript = page.text.match(/(window\.__MARKOUT_PROPS = [\s\S]*?);<\/script>/)![1];

    const window = new Window();
    window.document.write(page.text);

    // execute the two bootstrap scripts exactly as a browser would, just
    // without relying on happy-dom's own <script> auto-execution/fetching
    (window as any).eval(propsScript);
    (window as any).eval(runtime.text);

    const button = window.document.querySelector('button')!;
    expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('Clicked 0 times');

    button.dispatchEvent(new window.MouseEvent('click'));
    expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('Clicked 1 times');

    button.dispatchEvent(new window.MouseEvent('click'));
    button.dispatchEvent(new window.MouseEvent('click'));
    expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('Clicked 3 times');
  });
});
