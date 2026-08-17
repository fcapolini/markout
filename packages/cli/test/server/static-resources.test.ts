import { Application } from "express";
import path from 'path';
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Server } from "../../src/server";
import fs from "fs";
import os from "os";

describe("Static Resource Serving", () => {
  let tempDir: string;
  let server: Server;
  let app: Application;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "markout-static-test-"));
    
    // Create static resources
    fs.writeFileSync(path.join(tempDir, "style.css"), "body { color: red; }");
    fs.writeFileSync(path.join(tempDir, "script.js"), "console.log('hello');");
    fs.writeFileSync(path.join(tempDir, "data.json"), JSON.stringify({ message: "data" }));
    fs.writeFileSync(path.join(tempDir, "image.svg"), "<svg></svg>");
    
    // Create a text file
    fs.writeFileSync(path.join(tempDir, "readme.txt"), "This is a readme file");
    
    // Create files in subdirectory
    const assetsDir = path.join(tempDir, "assets");
    fs.mkdirSync(assetsDir);
    fs.writeFileSync(path.join(assetsDir, "icon.svg"), "<svg></svg>");
    fs.writeFileSync(path.join(assetsDir, "data.json"), JSON.stringify({ asset: "data" }));

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

  // Test CSS file serving
  it("should serve CSS files", async () => {
    const res = await request(app).get("/style.css");
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
    expect(res.text).toBe("body { color: red; }");
  });

  // Test JavaScript file serving
  it("should serve JavaScript files", async () => {
    const res = await request(app).get("/script.js");
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.text).toBe("console.log('hello');");
  });

  // Test JSON file serving
  it("should serve JSON files", async () => {
    const res = await request(app).get("/data.json");
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body).toEqual({ message: "data" });
  });

  // Test SVG file serving
  it("should serve SVG files", async () => {
    const res = await request(app).get("/image.svg");
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg');
  });

  // Test text file serving
  it("should serve text files", async () => {
    const res = await request(app).get("/readme.txt");
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toBe("This is a readme file");
  });

  // Test nested resource serving
  it("should serve resources from subdirectories", async () => {
    const res = await request(app).get("/assets/icon.svg");
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg');
  });

  // Test nested JSON serving
  it("should serve JSON files from subdirectories", async () => {
    const res = await request(app).get("/assets/data.json");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ asset: "data" });
  });

  // Test 404 for non-existent resources
  it("should return 404 for non-existent resources", async () => {
    const res = await request(app).get("/nonexistent.js");
    expect(res.status).toBe(404);
  });

  // Test common file types
  it("should serve .png images", async () => {
    const pngPath = path.join(tempDir, "image.png");
    fs.writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4E, 0x47])); // PNG header
    
    const res = await request(app).get("/image.png");
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  it("should serve .woff2 font files", async () => {
    const fontPath = path.join(tempDir, "font.woff2");
    fs.writeFileSync(fontPath, "font data");
    
    const res = await request(app).get("/font.woff2");
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('font');
  });
});
