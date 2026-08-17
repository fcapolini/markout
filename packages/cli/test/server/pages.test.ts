import { Application } from "express";
import path from 'path';
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "../../src/server";
import { Window } from "happy-dom";
import fs from "fs";
import os from "os";

describe("Page Serving", () => {
  let tempDir: string;
  let server: Server;
  let app: Application;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "markout-pages-test-"));
    
    // Create test pages
    fs.writeFileSync(path.join(tempDir, "index.html"), "<html><body><h1>Index</h1></body></html>");
    fs.writeFileSync(path.join(tempDir, "hello.html"), "<html><body><h1>Hello</h1></body></html>");
    
    // Create a subdirectory with index.html
    const subdir = path.join(tempDir, "subdir");
    fs.mkdirSync(subdir);
    fs.writeFileSync(path.join(subdir, "index.html"), "<html><body><h1>Subdir</h1></body></html>");

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

  describe("Root path and index resolution", () => {
    it("should return 200 on GET /", async () => {
      const res = await request(app).get("/");
      expect(res.status).toBe(200);
    });

    it("should return 200 on GET /index", async () => {
      const res = await request(app).get("/index");
      expect(res.status).toBe(200);
    });

    it("should return 200 on GET /index.html", async () => {
      const res = await request(app).get("/index.html");
      expect(res.status).toBe(200);
    });

    it("should parse and query index.html content with happy-dom", async () => {
      const res = await request(app).get("/");
      const window = new Window();
      window.document.write(res.text);
      const heading = window.document.querySelector("h1");
      expect(heading?.textContent).toBe("Index");
    });
  });

  describe("Named pages", () => {
    it("should return 200 on GET /hello.html", async () => {
      const res = await request(app).get("/hello.html");
      expect(res.status).toBe(200);
    });

    it("should return 200 on GET /hello (without extension)", async () => {
      const res = await request(app).get("/hello");
      expect(res.status).toBe(200);
    });

    it("should parse and query hello.html content with happy-dom", async () => {
      const res = await request(app).get("/hello.html");
      const window = new Window();
      window.document.write(res.text);
      const heading = window.document.querySelector("h1");
      expect(heading?.textContent).toBe("Hello");
    });
  });

  describe("Directory index resolution", () => {
    it("should return 200 on GET /subdir", async () => {
      const res = await request(app).get("/subdir");
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe("/subdir/");
    });

    it("should return 200 on GET /subdir/", async () => {
      const res = await request(app).get("/subdir/");
      expect(res.status).toBe(200);
    });

    it("should serve index.html from subdirectory", async () => {
      const res = await request(app).get("/subdir/");
      const window = new Window();
      window.document.write(res.text);
      const heading = window.document.querySelector("h1");
      expect(heading?.textContent).toBe("Subdir");
    });
  });

  describe("404 responses", () => {
    it("should return 404 for non-existent pages", async () => {
      const res = await request(app).get("/nonexistent.html");
      expect(res.status).toBe(404);
    });

    it("should return 404 for non-existent paths without extension", async () => {
      const res = await request(app).get("/nonexistent");
      expect(res.status).toBe(404);
    });
  });
});
