import { Application } from "express";
import fs from "fs";
import os from "os";
import path from 'path';
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "../../src/server";

// compression's default threshold is 1kb: anything smaller goes out as-is,
// so the fixtures have to be comfortably above it to prove anything
const FILLER = 'markout compression fixture. '.repeat(100);

function makeDocroot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "markout-compress-test-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<html><body><p>${FILLER}</p></body></html>`
  );
  fs.writeFileSync(path.join(dir, "style.css"), `/* ${FILLER} */`);
  return dir;
}

describe("Response compression", () => {
  let tempDir: string;
  let compressed: Server;
  let plain: Server;
  let compressedApp: Application;
  let plainApp: Application;

  beforeAll(async () => {
    tempDir = makeDocroot();
    compressed = new Server({ docroot: tempDir, compress: true, logger: () => {} });
    plain = new Server({ docroot: tempDir, logger: () => {} });
    await compressed.start();
    await plain.start();
    compressedApp = compressed.app!;
    plainApp = plain.app!;
  });

  afterAll(async () => {
    await compressed.stop();
    await plain.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("compresses rendered pages when enabled", async () => {
    const res = await request(compressedApp)
      .get("/index.html")
      .set("Accept-Encoding", "gzip");
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.text).toContain(FILLER.trim());
  });

  it("compresses static resources when enabled", async () => {
    const res = await request(compressedApp)
      .get("/style.css")
      .set("Accept-Encoding", "gzip");
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
  });

  it("leaves responses alone for clients that don't accept encodings", async () => {
    const res = await request(compressedApp)
      .get("/index.html")
      .set("Accept-Encoding", "identity");
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.text).toContain(FILLER.trim());
  });

  it("is off by default", async () => {
    const res = await request(plainApp)
      .get("/index.html")
      .set("Accept-Encoding", "gzip");
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.text).toContain(FILLER.trim());
  });
});
