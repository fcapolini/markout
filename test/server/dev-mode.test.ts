import { execSync } from 'child_process';
import fs from 'fs';
import { Browser } from 'happy-dom';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server } from '../../src/server';
import { CLIENT_CODE_REQ } from '../../src/server/middleware';
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

function listItems(html: string): string[] {
  return [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(m =>
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
    it('serves the page anyway, keeping runtime errors out of the markup', async () => {
      const res = await request(prodServer.app!).get('/broken.html');
      expect(res.status).toBe(200);
      expect(res.text).not.toContain(DOM_ERRORS_ID);
      // a failing expression must not cost a production page its runtime
      expect(res.text).toContain(CLIENT_CODE_REQ);
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
    it('replaces a page that failed server-side with an error page', async () => {
      const res = await request(devServer.app!).get('/broken.html');
      expect(res.status).toBe(500);
      const items = listItems(res.text);
      expect(items).toHaveLength(1);
      expect(items[0]).toContain('[update]');
      expect(items[0]).toContain("Cannot read properties of null (reading 'name')");
    });

    it('names the scope and value that failed', async () => {
      const res = await request(devServer.app!).get('/broken.html');
      // `s<n>.text$<n>` -- enough to find the expression in a page with many
      expect(listItems(res.text)[0]).toMatch(/ s\d+\.text\$\d+:/);
    });

    it('carries none of the failed page: no content, no runtime', async () => {
      const res = await request(devServer.app!).get('/broken.html');
      // shipping it would send the browser off to run the very same
      // expressions against the very same values and fail identically
      expect(res.text).not.toContain('__MARKOUT_PROPS');
      expect(res.text).not.toContain(CLIENT_CODE_REQ);
      expect(res.text).not.toContain('fine');
    });

    it('serves a page that rendered cleanly as normal, runtime and all', async () => {
      const res = await request(devServer.app!).get('/onclick.html');
      expect(res.status).toBe(200);
      expect(res.text).toContain('__MARKOUT_DEV = true');
      expect(res.text).toContain(CLIENT_CODE_REQ);
      expect(res.text).not.toContain(DOM_ERRORS_ID);
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
