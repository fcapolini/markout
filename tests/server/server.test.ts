import fs from 'fs';
import { Browser, BrowserPage } from 'happy-dom';
import path from 'path';
import { afterAll, afterEach, assert, beforeAll, it } from 'vitest';
import { Server } from '../../src/server/server';
import { normalizeText } from '../../src/html/parser';
import { CLIENT_CODE_REQ } from '../../src/server/middleware';

const docroot = path.join(__dirname, 'server');
const server = new Server({
  docroot,
  mute: true,
  clientCodePath: path.join(__dirname, '../../dist/client.js'),
});
const files = (() => {
  const ret = new Array<string>();
  const lookupIn = (dir: string) => {
    fs.readdirSync(path.join(docroot, dir)).forEach(file => {
      const relPath = path.join(dir, file);
      const absPath = path.join(docroot, relPath);
      const stat = fs.statSync(absPath);
      if (stat.isFile() && file.endsWith('-in.html')) {
        ret.push(relPath);
      } else if (stat.isDirectory()) {
        lookupIn(relPath);
      }
    });
  }
  lookupIn('.');
  return ret.sort();
})();
let browser: Browser | null = null;

beforeAll(async () => {
  await server.start();
});

afterAll(async () => {
  await server.stop();
});

afterEach(async () => {
  await browser?.close();
  browser = null;
});

it('should deliver client code', async () => {
  const res = await fetch(`http://127.0.0.1:${server.port}${CLIENT_CODE_REQ}`);
  assert.isTrue(res.ok);
  const text = await res.text();
  assert.isNotEmpty(text);
  assert.isTrue(text.startsWith('"use strict";(()=>{'), "invalid client code");
});

files.forEach(file => {

  it(file, async () => {
    browser = new Browser({ settings: { disableJavaScriptFileLoading: true } });
    const page = browser.newPage();

    // SSR
    await page.goto(`http://127.0.0.1:${server.port}/${file}`);
    const actual = getActual(page);
    const expected = getExpected(file, '-out.html');
    assert.equal(
      normalizeText(actual),
      normalizeText(expected)
    );

    // CSR
  });

});

function getActual(page: BrowserPage) {
  let ret = page.mainFrame.document.documentElement.outerHTML;
  // remove script tags
  ret = ret.replace(/<script.*?>.*?<\/script>/sg, '');
  // adapt line breaks
  ret = ret.replace('><head', '>\n<head');
  ret = ret.replace('></html>', '>\n</html>');
  // remove data-markout attributes
  ret = ret.replace(/ data-markout=".*?"/g, '');
  // remove dynamic text markers
  ret = ret.replace(/<!---.+?-->/g, '');
  return ret.trim();
}

function getExpected(file: string, suffix: string) {
  file = file.replace(/-in\.html$/, suffix);
  const pathname = path.join(docroot, file);
  let ret = fs.readFileSync(pathname).toString();
  return ret.trim();
}
