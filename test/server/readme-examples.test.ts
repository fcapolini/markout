import { execSync } from "child_process";
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, Window } from "happy-dom";
import request from "supertest";
import { Server } from "../../src/server";
import fs from "fs";
import os from "os";

// These mirror README.md's first three examples verbatim. Example 2
// ("Source level modularity") is deliberately NOT covered here: its
// <:define>/custom-tag usage (<theme-switcher />) doesn't actually get
// instantiated by the compiler today -- confirmed empirically, tracked as
// a known gap (see /memories/repo/markout4core.md) rather than tested as
// if it worked.

describe("README example: Integrated reactivity", () => {
  let tempDir: string;
  let server: Server;

  beforeAll(async () => {
    // guarantee a fresh dist/markout-runtime.js regardless of local state
    execSync('npm run build:runtime', { cwd: path.resolve(__dirname, '../..') });

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "markout-readme-ex1-"));
    fs.writeFileSync(
      path.join(tempDir, "index.html"),
      `<html :count=\${0} :light=\${true}>
  <head>
    <style>
      body {
        color: \${light ? 'black' : 'white'};
        background-color: \${light ? 'white' : 'black'};
      }
    </style>
  </head>
  <body>
    <button :on-click=\${() => count++}>
      Clicked \${count} time\${count !== 1 ? 's' : ''}
    </button>
    <button :on-click=\${() => light = !light}>
      Switch theme
    </button>
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

  it('server-renders the initial count (with correct pluralization) and theme colors', async () => {
    const res = await request(server.app!).get('/index.html');
    expect(res.status).toBe(200);

    const window = new Window();
    const document = window.document as any;
    document.write(res.text);

    expect(document.querySelectorAll('button')[0].textContent.replace(/\s+/g, ' ').trim())
      .toBe('Clicked 0 times');
    expect(document.querySelector('style').textContent).toContain('color: black');
    expect(document.querySelector('style').textContent).toContain('background-color: white');
  });

  it('hydrates and reacts to real clicks on both buttons, independently', async () => {
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const page = browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/index.html`);
      await page.waitUntilComplete();

      const document = page.mainFrame.document;
      const [countButton, themeButton] = document.querySelectorAll('button');
      const click = () => new page.mainFrame.window.MouseEvent('click');
      const text = (el: any) => el.textContent.replace(/\s+/g, ' ').trim();

      expect(text(countButton)).toBe('Clicked 0 times');

      countButton.dispatchEvent(click());
      expect(text(countButton)).toBe('Clicked 1 time');

      countButton.dispatchEvent(click());
      expect(text(countButton)).toBe('Clicked 2 times');

      const style = document.querySelector('style')!;
      expect(style.textContent).toContain('color: black');

      themeButton.dispatchEvent(click());
      expect(style.textContent).toContain('color: white');
      // switching theme must not affect the independent count value
      expect(text(countButton)).toBe('Clicked 2 times');
    } finally {
      await browser.close();
    }
  });
});

describe("README example: Replication", () => {
  let tempDir: string;
  let server: Server;

  beforeAll(async () => {
    execSync('npm run build:runtime', { cwd: path.resolve(__dirname, '../..') });

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "markout-readme-ex3-"));
    fs.writeFileSync(
      path.join(tempDir, "index.html"),
      `<html>
  <body>
    <ul :for-each=\${[[1, 2, 3], [4, 5]]}>
      <li :for-each=\${data}>
        Item \${data}
      </li>
    </ul>
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

  it('server-renders each sub-array as its own list, with every item actually visible', async () => {
    const res = await request(server.app!).get('/index.html');
    expect(res.status).toBe(200);

    // a real DOM, not string inspection: a naive markup check can't tell
    // the inert <template> stencil's own item apart from a real, visible
    // clone -- only a real querySelectorAll reflects what a browser shows
    const window = new Window();
    const document = window.document as any;
    document.write(res.text);

    const lists = document.querySelectorAll('ul');
    expect(lists.length).toBe(2);
    expect(lists[0].querySelectorAll('li').length).toBe(3);
    expect(lists[1].querySelectorAll('li').length).toBe(2);

    const bodyText = document.body.textContent.replace(/\s+/g, ' ');
    for (const n of [1, 2, 3, 4, 5]) {
      expect(bodyText).toContain(`Item ${n}`);
    }
  });

  it('hydrates in a real browser without duplicating or losing any items', async () => {
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const page = browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/index.html`);
      await page.waitUntilComplete();

      const document = page.mainFrame.document;
      const lists = document.querySelectorAll('ul');
      expect(lists.length).toBe(2);
      expect(lists[0].querySelectorAll('li').length).toBe(3);
      expect(lists[1].querySelectorAll('li').length).toBe(2);
    } finally {
      await browser.close();
    }
  });
});
