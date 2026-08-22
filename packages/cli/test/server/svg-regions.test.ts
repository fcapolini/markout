import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser } from 'happy-dom';
import { Server } from '../../src/server';
import fs from 'fs';
import os from 'os';

/**
 * A region inside inline SVG, in a DOM that has namespaces.
 *
 * The one case a stencil cannot be moved out of the way naively. `<circle>`
 * means an SVG circle inside `<svg>` and an unknown HTML element anywhere
 * else, and a stencil in <head> is anywhere else -- so the markup travels
 * with an `<svg>` around it (stage7's wrapForeignContent) and the clone
 * comes out in the namespace it was written in.
 *
 * Asserted through a real parse of the served bytes rather than against the
 * compiler's own DOM, which has no namespaces to get wrong. Before the
 * stencils moved this crashed outright -- foreign content has no HTML
 * `<template>`, so there was no `.content` to park an element in -- and the
 * first cut of the move turned that into an element that renders nothing
 * and reports nothing, which is worse.
 */
describe('a region inside inline SVG', () => {
  let tempDir: string;
  let server: Server;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'markout-svg-'));
    fs.writeFileSync(
      path.join(tempDir, 'svg.html'),
      `<html :on=\${false} :dots=\${[2, 5, 8]}>
        <body>
          <svg viewBox="0 0 10 10" width="10" height="10">
            <circle id="dot" :if=\${on} cx="5" cy="5" r="4" />
            <rect :for-each=\${dots} x=\${data} y="1" width="1" height="1" />
            <foreignObject x="0" y="0" width="4" height="4">
              <b id="html" :if=\${on}>html again</b>
            </foreignObject>
          </svg>
          <button :on-click=\${() => on = !on}>flip</button>
        </body>
      </html>`
    );
    server = new Server({ docroot: tempDir });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('stamps a hidden one out in the namespace it was written in', async () => {
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const page = browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/svg.html`);
      await page.waitUntilComplete();
      const document = page.mainFrame.document;

      expect(document.querySelector('#dot')).toBe(null);
      document
        .querySelector('button')!
        .dispatchEvent(new page.mainFrame.window.MouseEvent('click'));

      expect(document.querySelector('#dot')?.namespaceURI).toBe(
        'http://www.w3.org/2000/svg'
      );
      // and back out again: `<foreignObject>` is HTML, and wrapping that in
      // an <svg> would put it in the wrong one just as surely
      expect(document.querySelector('#html')?.namespaceURI).toBe(
        'http://www.w3.org/1999/xhtml'
      );
    } finally {
      await browser.close();
    }
  });

  it('replicates in it too, where every replica is a clone of the stencil', async () => {
    const browser = new Browser({ settings: { enableJavaScriptEvaluation: true } });
    try {
      const page = browser.newPage();
      await page.goto(`http://127.0.0.1:${server.port}/svg.html`);
      await page.waitUntilComplete();
      const rects = [...page.mainFrame.document.querySelectorAll('rect')];

      expect(rects.map(r => r.getAttribute('x'))).toEqual(['2', '5', '8']);
      expect(rects.every(r => r.namespaceURI === 'http://www.w3.org/2000/svg')).toBe(true);
    } finally {
      await browser.close();
    }
  });
});
