import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_PAGE_LIMIT, Server, type ServerProps } from "../../src/server";

/**
 * The cap on page requests, and -- as much as the cap itself -- what it
 * declines to count. A budget shared with a page's own stylesheet and images
 * would be spent by one visitor scrolling, so most of this suite is about
 * requests that must NOT reach the counter.
 */
describe("pageLimit", () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "markout-limit-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<html><body><h1>Home</h1></body></html>");
    fs.writeFileSync(path.join(dir, "other.html"), "<html><body><h1>Other</h1></body></html>");
    fs.writeFileSync(path.join(dir, "style.css"), "body { color: red }");
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const serve = (props: Partial<ServerProps>) =>
    new Server({ docroot: dir, mute: true, ...props }).create();

  it("is off unless asked for", async () => {
    const app = await serve({});
    for (let i = 0; i < 12; i++) {
      expect((await request(app).get("/index.html")).status).toBe(200);
    }
  });

  it("caps page requests once configured", async () => {
    const app = await serve({ pageLimit: { windowMs: 60_000, maxRequests: 3 } });
    for (let i = 0; i < 3; i++) {
      expect((await request(app).get("/index.html")).status).toBe(200);
    }
    const over = await request(app).get("/index.html");
    expect(over.status).toBe(429);
  });

  it("spends one budget across different pages, not one each", async () => {
    const app = await serve({ pageLimit: { windowMs: 60_000, maxRequests: 2 } });
    expect((await request(app).get("/index.html")).status).toBe(200);
    expect((await request(app).get("/other.html")).status).toBe(200);
    expect((await request(app).get("/index.html")).status).toBe(429);
  });

  it("counts an extensionless path, which is a page too", async () => {
    const app = await serve({ pageLimit: { windowMs: 60_000, maxRequests: 2 } });
    expect((await request(app).get("/")).status).toBe(200);
    expect((await request(app).get("/other")).status).toBe(200);
    expect((await request(app).get("/")).status).toBe(429);
  });

  it("does not count static resources", async () => {
    const app = await serve({ pageLimit: { windowMs: 60_000, maxRequests: 2 } });
    // a page pulls a dozen of these; counting them would spend the budget on
    // one ordinary visit
    for (let i = 0; i < 20; i++) {
      expect((await request(app).get("/style.css")).status).toBe(200);
    }
    expect((await request(app).get("/index.html")).status).toBe(200);
  });

  it("does not count the application's own routes", async () => {
    const app = await serve({
      pageLimit: { windowMs: 60_000, maxRequests: 2 },
      // an API path has no extension, so it would look exactly like a page
      // to the counter if the counter ever saw it
      routes: { "/api": (_req, res) => { res.json({ ok: true }); } },
    });
    for (let i = 0; i < 20; i++) {
      expect((await request(app).get("/api/items")).status).toBe(200);
    }
    expect((await request(app).get("/index.html")).status).toBe(200);
  });

  it("takes `true` for the built-in defaults", async () => {
    expect(DEFAULT_PAGE_LIMIT.maxRequests).toBeGreaterThan(100);
    const app = await serve({ pageLimit: true });
    // the whole point of the default being generous: ordinary use is nowhere
    // near it
    for (let i = 0; i < 30; i++) {
      expect((await request(app).get("/index.html")).status).toBe(200);
    }
  });

  it("sends the standard headers and no legacy ones", async () => {
    const app = await serve({ pageLimit: { windowMs: 60_000, maxRequests: 5 } });
    const res = await request(app).get("/index.html");
    expect(res.headers["ratelimit-limit"] ?? res.headers["ratelimit"]).toBeDefined();
    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
  });

  it("warns once when a proxy is in front and trustProxy is not set", async () => {
    const said: string[] = [];
    const app = await new Server({
      docroot: dir,
      logger: (type, msg) => { said.push(`${type} ${msg}`); },
      pageLimit: { windowMs: 60_000, maxRequests: 100 },
    }).create();

    await request(app).get("/index.html").set("X-Forwarded-For", "203.0.113.7");
    const warnings = said.filter(l => l.includes("counting every visitor as one"));
    expect(warnings.length).toBe(1);

    await request(app).get("/index.html").set("X-Forwarded-For", "203.0.113.8");
    expect(said.filter(l => l.includes("counting every visitor as one")).length).toBe(1);
  });

  it("says nothing when the proxy is declared", async () => {
    const said: string[] = [];
    const app = await new Server({
      docroot: dir,
      trustProxy: true,
      logger: (type, msg) => { said.push(`${type} ${msg}`); },
      pageLimit: { windowMs: 60_000, maxRequests: 100 },
    }).create();

    await request(app).get("/index.html").set("X-Forwarded-For", "203.0.113.7");
    expect(said.filter(l => l.includes("counting every visitor as one"))).toEqual([]);
  });

  it("separates addresses once the proxy is declared", async () => {
    const app = await serve({
      trustProxy: true,
      pageLimit: { windowMs: 60_000, maxRequests: 2 },
    });
    const get = (ip: string) =>
      request(app).get("/index.html").set("X-Forwarded-For", ip);

    expect((await get("203.0.113.1")).status).toBe(200);
    expect((await get("203.0.113.1")).status).toBe(200);
    expect((await get("203.0.113.1")).status).toBe(429);
    // a different visitor has their own budget, which is the whole reason
    // trustProxy matters to this
    expect((await get("203.0.113.2")).status).toBe(200);
  });
});
