import express, { Application, Request, Response, NextFunction } from "express";
import fs from "fs";
import os from "os";
import path from "path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "../../src/server";
import { cspNonce } from "@markout-dev/express";

/**
 * The props that exist so an application does not have to hand-roll its own
 * Express app around `markout()`. What each one is really being asked is
 * whether it lands in the right place in the mount order, so most of these
 * assert against a path that two layers could plausibly claim.
 */
function makeDocroot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "markout-props-test-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html><body><h1>Home</h1></body></html>");
  fs.writeFileSync(path.join(dir, "api.html"), "<html><body><h1>Page named api</h1></body></html>");
  return dir;
}

describe("Server props", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = makeDocroot();
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("create()", () => {
    it("configures the app without listening", async () => {
      const server = new Server({ docroot: tempDir, mute: true });
      const app = await server.create();
      expect(server.server).toBeUndefined();
      expect(server.port).toBeUndefined();
      const res = await request(app).get("/index.html");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Home");
    });

    it("builds once, so start() listens on the app already configured", async () => {
      const server = new Server({ docroot: tempDir, mute: true });
      const first = await server.create();
      expect(await server.create()).toBe(first);
      await server.start();
      expect(server.app).toBe(first);
      await server.stop();
    });
  });

  describe("csp", () => {
    it("reaches the middleware, and `init` is where the header goes", async () => {
      // The point of the prop being here at all: `Server` is the arrangement
      // where nobody hand-rolls an app, so without it a project would have to
      // abandon `Server` to get a nonce. `init` mounts before the pages,
      // which is the order this has to happen in -- see cspNonce()
      const server = new Server({
        docroot: tempDir,
        mute: true,
        csp: true,
        init: app => {
          app.use(cspNonce());
          app.use((_req: Request, res: Response, next: NextFunction) => {
            res.setHeader(
              "Content-Security-Policy",
              `script-src 'nonce-${res.locals.markoutNonce}'`
            );
            next();
          });
        },
      });
      const app = await server.create();

      const res = await request(app).get("/index.html");
      expect(res.status).toBe(200);
      const nonce = res.text.match(/nonce="([^"]*)"/)?.[1];
      expect(nonce).toBeTruthy();
      // the page names the same nonce the policy does, which is the whole
      // contract between the two halves
      expect(res.headers["content-security-policy"]).toBe(
        `script-src 'nonce-${nonce}'`
      );
    });

    it("is off unless asked for", async () => {
      const server = new Server({ docroot: tempDir, mute: true });
      const app = await server.create();
      const res = await request(app).get("/index.html");

      expect(res.text).not.toContain("nonce");
    });
  });

  describe("routes", () => {
    let server: Server;
    let app: Application;

    beforeAll(async () => {
      server = new Server({
        docroot: tempDir,
        mute: true,
        routes: {
          // the case that needs the order to be right: `/api` is also a page
          // in the docroot, and the application's handler is the one that
          // should answer
          "/api": (_req: Request, res: Response) => { res.json({ from: "the application" }); },
          "/assets": express.static(tempDir),
        },
      });
      app = await server.create();
    });

    it("answers before markout does", async () => {
      const res = await request(app).get("/api");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ from: "the application" });
    });

    it("answers a path below the mount too", async () => {
      const res = await request(app).get("/api/anything");
      expect(res.body).toEqual({ from: "the application" });
    });

    it("leaves every other path to markout", async () => {
      const res = await request(app).get("/");
      expect(res.status).toBe(200);
      expect(res.text).toContain("Home");
    });

    it("mounts any handler, static included", async () => {
      const res = await request(app).get("/assets/index.html");
      expect(res.status).toBe(200);
      // straight off disk, not compiled: the page markout serves carries a
      // doctype and the runtime, this one is the file
      expect(res.text).toBe("<html><body><h1>Home</h1></body></html>");
    });
  });

  describe("init", () => {
    it("runs in the same position as routes, with the app", async () => {
      const server = new Server({
        docroot: tempDir,
        mute: true,
        init: a => {
          a.post("/echo", (req: Request, res: Response) => { res.json(req.body); });
        },
      });
      const app = await server.create();
      const res = await request(app).post("/echo").send({ hello: "world" });
      expect(res.body).toEqual({ hello: "world" });
    });

    it("is awaited, so async setup finishes before any request", async () => {
      let opened = false;
      const server = new Server({
        docroot: tempDir,
        mute: true,
        init: async a => {
          await new Promise(r => setTimeout(r, 10));
          opened = true;
          a.get("/db", (_req: Request, res: Response) => { res.json({ opened }); });
        },
      });
      const app = await server.create();
      expect(opened).toBe(true);
      expect((await request(app).get("/db")).body).toEqual({ opened: true });
    });

    it("runs after routes when both are given", async () => {
      const order: string[] = [];
      const server = new Server({
        docroot: tempDir,
        mute: true,
        routes: {
          "/x": (_req: Request, _res: Response, next: NextFunction) => { order.push("routes"); next(); },
        },
        init: a => {
          a.use("/x", (_req: Request, res: Response) => { order.push("init"); res.end(); });
        },
      });
      await request(await server.create()).get("/x");
      expect(order).toEqual(["routes", "init"]);
    });
  });

  describe("fallback", () => {
    it("sees what neither markout nor the static layer claimed", async () => {
      const server = new Server({
        docroot: tempDir,
        mute: true,
        fallback: a => {
          a.use((_req: Request, res: Response) => { res.status(404).type("html").send("<h1>custom</h1>"); });
        },
      });
      const app = await server.create();
      const res = await request(app).get("/missing.png");
      expect(res.status).toBe(404);
      expect(res.text).toBe("<h1>custom</h1>");
    });

    it("does NOT see a missing page: markout answers that itself", async () => {
      const server = new Server({
        docroot: tempDir,
        mute: true,
        fallback: a => {
          a.use((_req: Request, res: Response) => { res.status(404).send("<h1>custom</h1>"); });
        },
      });
      const res = await request(await server.create()).get("/no-such-page");
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("custom");
    });

    it("catches errors thrown by anything mounted before it", async () => {
      const server = new Server({
        docroot: tempDir,
        mute: true,
        routes: {
          "/boom": () => {
            throw new Error("kaboom");
          },
        },
        fallback: a => {
          // Express recognizes an error handler by its four arguments
          a.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
            res.status(500).json({ caught: err.message });
          });
        },
      });
      const res = await request(await server.create()).get("/boom");
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ caught: "kaboom" });
    });
  });

  describe("trustProxy", () => {
    const setting = async (trustProxy: boolean | number | string | undefined) => {
      const server = new Server({ docroot: tempDir, mute: true, trustProxy });
      return (await server.create()).get("trust proxy");
    };

    it("is off unless asked for", async () => {
      // Express' own default, which is what "never configured" has to stay
      expect(await setting(undefined)).toBe(false);
      expect(await setting(false)).toBe(false);
    });

    it("keeps meaning one hop for `true`", async () => {
      expect(await setting(true)).toBe(1);
    });

    it("takes a hop count or an address", async () => {
      expect(await setting(2)).toBe(2);
      expect(await setting("10.0.0.0/8")).toBe("10.0.0.0/8");
    });

    it("makes the forwarded protocol the one $origin is built from", async () => {
      // the reason this prop matters to a PAGE: `$origin` is
      // `${req.protocol}://${req.get('host')}`, so untrusted the protocol
      // reads `http` behind a TLS-terminating proxy and every relative
      // `:server-` fetch goes out addressed to the wrong scheme
      const seen = async (trustProxy: boolean) => {
        const server = new Server({
          docroot: tempDir,
          mute: true,
          trustProxy,
          routes: {
            "/origin": (req: Request, res: Response) => {
              res.json({ origin: `${req.protocol}://${req.get("host")}` });
            },
          },
        });
        const res = await request(await server.create())
          .get("/origin")
          .set("X-Forwarded-Proto", "https");
        return res.body.origin as string;
      };
      expect(await seen(true)).toMatch(/^https:\/\//);
      expect(await seen(false)).toMatch(/^http:\/\//);
    });
  });

  describe("bodyLimit", () => {
    const post = async (bodyLimit: string | undefined) => {
      const server = new Server({
        docroot: tempDir,
        mute: true,
        bodyLimit,
        routes: {
          "/echo": (req: Request, res: Response) => {
            res.json({ size: JSON.stringify(req.body).length });
          },
        },
      });
      return request(await server.create())
        .post("/echo")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ blob: "x".repeat(200 * 1024) }));
    };

    it("refuses a body over Express' 100kb default", async () => {
      expect((await post(undefined)).status).toBe(413);
    });

    it("accepts it when the limit is raised", async () => {
      const res = await post("1mb");
      expect(res.status).toBe(200);
      expect(res.body.size).toBeGreaterThan(200 * 1024);
    });
  });

  describe("mute", () => {
    it("says nothing, and overrides an explicit logger", async () => {
      const said: unknown[] = [];
      const server = new Server({
        docroot: tempDir,
        mute: true,
        logger: (_type, msg) => { said.push(msg); },
      });
      await server.start();
      await server.stop();
      expect(said).toEqual([]);
    });
  });

  describe("hostname", () => {
    it("binds the address it was given", async () => {
      const server = new Server({ docroot: tempDir, mute: true, hostname: "127.0.0.1" });
      await server.start();
      const address = server.server!.address() as { address: string };
      expect(address.address).toBe("127.0.0.1");
      const res = await request(`http://127.0.0.1:${server.port}`).get("/index.html");
      expect(res.status).toBe(200);
      await server.stop();
    });
  });

  describe("ssl", () => {
    it("fails loudly, naming the file, when the pair cannot be read", async () => {
      const server = new Server({
        docroot: tempDir,
        mute: true,
        ssl: { key: path.join(tempDir, "no-such.key"), cert: path.join(tempDir, "no-such.crt") },
      });
      await expect(server.start()).rejects.toThrow(/no-such\.key/);
    });
  });

  describe("stop", () => {
    it("waits until the port is free, so the next server can take it", async () => {
      const first = new Server({ docroot: tempDir, mute: true, hostname: "127.0.0.1" });
      await first.start();
      const port = first.port!;
      await first.stop();
      const second = new Server({ docroot: tempDir, mute: true, hostname: "127.0.0.1", port });
      await second.start();
      expect(second.port).toBe(port);
      await second.stop();
    });
  });
});
