import { Application } from "express";
import path from 'path';
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "../../src/server";
import fs from "fs";
import os from "os";

// extracts the object literal source assigned to window.__MARKOUT_PROPS from
// the raw served HTML, and evaluates it into a real object -- proof the
// server actually ran the compiler, not just that it returned 200
function extractProps(html: string): any {
  const match = html.match(/window\.__MARKOUT_PROPS = ([\s\S]*?);<\/script>/);
  if (!match) {
    throw new Error('could not find window.__MARKOUT_PROPS in served HTML');
  }
  return new Function(`return (${match[1]});`)();
}

describe("Reactive page compilation", () => {
  let tempDir: string;
  let server: Server;
  let app: Application;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "markout-reactive-test-"));
    fs.writeFileSync(
      path.join(tempDir, "counter.html"),
      '<html :count=${0}><body :on-click=${() => count++}>Clicked ${count} times</body></html>'
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

  it('should serve compiled markup with data-markout ids and bootstrap scripts', async () => {
    const res = await request(app).get('/counter.html');

    expect(res.status).toBe(200);
    expect(res.text).toContain('data-markout="s1"');
    expect(res.text).toContain('window.__MARKOUT_PROPS =');
    expect(res.text).toContain('<script src="/.markout.js" async></script>');
  });

  it('should compile :count/:on-click/${count} into real, runnable props', async () => {
    const res = await request(app).get('/counter.html');
    const props = extractProps(res.text);

    expect(props.values.count.exp.apply({})).toBe(0);

    const body = props.children[1];
    expect(typeof body.values['event$click'].exp.apply({ count: 5 })).toBe('function');

    const fakeScope = { count: 5, $value: () => ({}) };
    expect(body.values['text$1'].exp.apply(fakeScope)).toBe(5);
    expect(body.values['text$1'].deps[0].apply({ $value: (key: string) => key })).toBe('count');
  });
});
