import { execSync } from 'child_process';
import fs from 'fs';
import { Browser } from 'happy-dom';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server } from '../../src/server';
import { DOM_ERRORS_ID } from '../../src/runtime/web/web-context';

// `user` is null, so `${user.name}` throws every time it's evaluated -- a
// perfectly ordinary runtime failure that the compiler can't catch, since
// `user` itself is declared
const BROKEN = `<html :user=\${null}>
  <body>
    <p>hello \${user.name}</p>
    <p>fine \${1 + 1}</p>
  </body>
</html>`;

// renders cleanly, then breaks only once the button is clicked -- so the
// panel can only come from the browser runtime, never from SSR
const BREAKS_ON_CLICK = `<html :user=\${{name: 'ann'}}>
  <body>
    <button :on-click=\${() => user = null}>break</button>
    <p>hello \${user.name}</p>
  </body>
</html>`;

function panelEntries(html: string): string[] {
  const panel = html.match(
    new RegExp(`<ul id="${DOM_ERRORS_ID}"[\\s\\S]*?</ul>`)
  );
  if (!panel) {
    return [];
  }
  return [...panel[0].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(m =>
    m[1].replace(/\s+/g, ' ').trim()
  );
}

describe('dev mode: runtime error reporting', () => {
  let tempDir: string;
  let devServer: Server;
  let prodServer: Server;

  beforeAll(async () => {
    execSync('npm run build:runtime', { cwd: path.resolve(__dirname, '../..') });
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-dev-test-'));
    fs.writeFileSync(path.join(tempDir, 'broken.html'), BROKEN);
    fs.writeFileSync(path.join(tempDir, 'onclick.html'), BREAKS_ON_CLICK);

    devServer = new Server({ docroot: tempDir, dev: true, logger: () => {} });
    prodServer = new Server({ docroot: tempDir, logger: () => {} });
    await devServer.start();
    await prodServer.start();
  });

  afterAll(async () => {
    await devServer.stop();
    await prodServer.stop();
    fs.existsSync(tempDir) && fs.rmSync(tempDir, { recursive: true });
  });

  describe('without dev mode', () => {
    it('keeps runtime errors out of the served markup', async () => {
      const res = await request(prodServer.app!).get('/broken.html');
      expect(res.status).toBe(200);
      expect(panelEntries(res.text)).toStrictEqual([]);
      expect(res.text).not.toContain(DOM_ERRORS_ID);
    });

    it('does not tell the browser runtime to surface them either', async () => {
      const res = await request(prodServer.app!).get('/broken.html');
      expect(res.text).not.toContain('__MARKOUT_DEV');
    });

    it('still renders the rest of the page, with the failed value empty', async () => {
      const res = await request(prodServer.app!).get('/broken.html');
      const text = res.text.replace(/<script[\s\S]*?<\/script>/g, '');
      expect(text).toContain('fine ');
      expect(text).toContain('2');
      // the failing interpolation contributes nothing rather than breaking
      // the page or emitting "undefined"
      expect(text).not.toContain('undefined');
    });
  });

  describe('with dev mode', () => {
    it('surfaces SSR expression errors in the served markup', async () => {
      const res = await request(devServer.app!).get('/broken.html');
      const entries = panelEntries(res.text);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toContain('[update]');
      expect(entries[0]).toContain("Cannot read properties of null (reading 'name')");
    });

    it('names the scope and value that failed', async () => {
      const res = await request(devServer.app!).get('/broken.html');
      // `s<n>.text$<n>` -- enough to find the expression in a page with many
      expect(panelEntries(res.text)[0]).toMatch(/ s\d+\.text\$\d+:/);
    });

    it('tells the browser runtime to do the same after hydration', async () => {
      const res = await request(devServer.app!).get('/broken.html');
      expect(res.text).toContain('__MARKOUT_DEV = true');
    });
  });

  describe('in the browser', () => {
    async function withPage<T>(
      port: number,
      file: string,
      fn: (page: any) => Promise<T> | T
    ): Promise<T> {
      const browser = new Browser({
        settings: { enableJavaScriptEvaluation: true },
      });
      try {
        const page = browser.newPage();
        await page.goto(`http://127.0.0.1:${port}/${file}`);
        await page.waitUntilComplete();
        return await fn(page);
      } finally {
        await browser.close();
      }
    }

    it('does not duplicate an SSR-reported error after hydration', async () => {
      await withPage(devServer.port!, 'broken.html', page => {
        const doc = page.mainFrame.document;
        const rows = doc.querySelectorAll(`#${DOM_ERRORS_ID} li`);
        // the browser re-evaluates the same expression and hits the same
        // failure; it belongs in the row SSR already wrote, not a second one
        expect(rows.length).toBe(1);
      });
    });

    it('surfaces an error that only happens in the browser', async () => {
      await withPage(devServer.port!, 'onclick.html', page => {
        const doc = page.mainFrame.document;
        expect(doc.querySelectorAll(`#${DOM_ERRORS_ID} li`).length).toBe(0);

        doc
          .querySelector('button')!
          .dispatchEvent(new page.mainFrame.window.MouseEvent('click'));

        const rows = doc.querySelectorAll(`#${DOM_ERRORS_ID} li`);
        expect(rows.length).toBe(1);
        expect(rows[0].textContent).toContain("reading 'name'");
      });
    });

    it('shows nothing in the page when dev mode is off', async () => {
      await withPage(prodServer.port!, 'onclick.html', page => {
        const doc = page.mainFrame.document;
        doc
          .querySelector('button')!
          .dispatchEvent(new page.mainFrame.window.MouseEvent('click'));
        expect(doc.querySelector(`#${DOM_ERRORS_ID}`)).toBeNull();
      });
    });
  });
});
