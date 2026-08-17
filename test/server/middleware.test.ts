import { Application } from "express";
import path from 'path';
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "../../src/server";
import { resolvePath } from "../../src/server/middleware";
import { Resolver } from "../../src/paths";
import { Window } from "happy-dom";
import fs from "fs";
import os from "os";

describe("Middleware", () => {
  let tempDir: string;
  let server: Server;
  let app: Application;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "markout-middleware-test-"));
    
    // Create test files
    fs.writeFileSync(path.join(tempDir, "test.html"), "<html><body><h1>Test</h1></body></html>");
    fs.writeFileSync(path.join(tempDir, "index.html"), "<html><body><h1>Index</h1></body></html>");
    
    // Create a subdirectory with index.html
    const subdir = path.join(tempDir, "subdir");
    fs.mkdirSync(subdir);
    fs.writeFileSync(path.join(subdir, "index.html"), "<html><body><h1>Subdir</h1></body></html>");

    // Create a file with compilation errors
    fs.writeFileSync(path.join(tempDir, "error.html"), "<html><body>{{ unclosed");

    // what a certificate authority asks for, and what `security.txt` lives in
    const wellKnown = path.join(tempDir, ".well-known", "acme-challenge");
    fs.mkdirSync(wellKnown, { recursive: true });
    fs.writeFileSync(path.join(wellKnown, "TOKEN"), "proof-of-control");
    fs.writeFileSync(
      path.join(tempDir, ".well-known", "security.txt"),
      "Contact: mailto:security@example.test\n"
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

  // Test basic HTML file serving
  it("should serve HTML files with 200 status", async () => {
    const res = await request(app).get("/test.html");
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it("should serve index.html for root path", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    const window = new Window();
    window.document.write(res.text);
    const heading = window.document.querySelector("h1");
    expect(heading?.textContent).toBe("Index");
  });

  it("should serve index.html for directory paths", async () => {
    const res = await request(app).get("/subdir");
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("/subdir/");
  });

  it("should serve index.html for directory paths with trailing slash", async () => {
    const res = await request(app).get("/subdir/");
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  // Test hidden file protection
  it("should return 404 for hidden files starting with /.", async () => {
    const res = await request(app).get("/.env");
    expect(res.status).toBe(404);
  });

  it("should return 404 for .htm files", async () => {
    const res = await request(app).get("/test.htm");
    expect(res.status).toBe(404);
  });

  // The one dot-path that exists in order to be public (RFC 8615), so the
  // hidden-file refusal above lets it through to the static layer -- which is
  // also what makes a certificate issuable for a docroot served by markout
  // directly, and what `build` copies for the same reason.
  it("should pass /.well-known/ through to the static layer", async () => {
    const res = await request(app).get("/.well-known/acme-challenge/TOKEN");
    expect(res.status).toBe(200);
    // no extension, so no content type supertest parses as text
    expect((res.text ?? Buffer.from(res.body).toString())).toBe("proof-of-control");
  });

  // no extension, as an ACME token has none: it must not be resolved as a page
  it("should not treat a /.well-known/ path as a page request", async () => {
    const res = await request(app).get("/.well-known/security.txt");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Contact:");
  });

  // Test non-HTML file handling
  it("should pass through non-HTML files to next middleware", async () => {
    const res = await request(app).get("/test.js");
    expect(res.status).toBe(404); // No static middleware to serve it
  });

  it("should pass through .css files to next middleware", async () => {
    const res = await request(app).get("/style.css");
    expect(res.status).toBe(404);
  });

  // Test client code request
  it("should return client code for /markout-runtime.js", async () => {
    const res = await request(app).get("/markout-runtime.js");
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
  });

  // Test 404 for non-existent files
  it("should return 404 for non-existent HTML files", async () => {
    const res = await request(app).get("/nonexistent.html");
    expect(res.status).toBe(404);
  });

  // Test file resolution without extension
  it("should serve HTML file when accessed without extension", async () => {
    const res = await request(app).get("/test");
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  // Test compilation errors
  it("should return 500 for files with compilation errors", async () => {
    const res = await request(app).get("/error.html");
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain("Page Error");
  });

  // Test with uppercase extension handling
  it("should handle uppercase .HTML extension", async () => {
    const res = await request(app).get("/test.HTML");
    expect(res.status).toBe(200);
  });

  // Test path without extension that doesn't exist
  it("should return 404 for non-existent path without extension", async () => {
    const res = await request(app).get("/doesnotexist");
    expect(res.status).toBe(404);
  });
});

describe("Middleware path containment", () => {
  let tempRoot: string;
  let docroot: string;

  beforeAll(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "markout-middleware-sec-"));
    docroot = path.join(tempRoot, "site");
    fs.mkdirSync(docroot);
    fs.writeFileSync(path.join(docroot, "index.html"), "<html><body>ok</body></html>");

    // sibling directory sharing docroot's prefix, simulating a bypass target
    const sibling = path.join(tempRoot, "site-secret");
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, "passwd.html"), "TOP SECRET");
  });

  afterAll(() => {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true });
    }
  });

  // Express itself normalizes `..` out of req.path before middleware ever
  // sees it, so this can't be reproduced through an actual HTTP request;
  // resolvePath is exported so this class of bug can be tested directly.
  it("should not resolve a path escaping to a sibling directory sharing the docroot's prefix", async () => {
    const fakeReq = { path: "/../site-secret/passwd" } as any;
    const result = await resolvePath(fakeReq, -1, new Resolver(docroot));
    expect(result).toBeUndefined();
  });
});
