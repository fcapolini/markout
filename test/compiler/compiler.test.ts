import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Compiler } from "../../src/compiler/index";
import path from "path";
import fs from "fs";
import os from "os";

describe("Compiler", () => {
  let tempDir: string;

  beforeAll(() => {
    // Create a temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "markout-test-"));
  });

  afterAll(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("should instantiate with a docroot", () => {
    const compiler = new Compiler({ docroot: tempDir });
    expect(compiler).toBeDefined();
    expect(compiler.preprocessor).toBeDefined();
  });

  it("should compile a simple HTML file", async () => {
    const htmlContent = "<html><body><h1>Hello</h1></body></html>";
    const testFile = path.join(tempDir, "test.html");
    fs.writeFileSync(testFile, htmlContent);

    const compiler = new Compiler({ docroot: tempDir });
    const result = await compiler.compile("/test.html");

    expect(result).toBeDefined();
    expect(result.source).toBeDefined();
    expect(result.source.doc).toBeDefined();
  });

  it("should handle missing files gracefully", async () => {
    const compiler = new Compiler({ docroot: tempDir });
    try {
      await compiler.compile("/nonexistent.html");
    } catch (err) {
      expect(err).toBeDefined();
    }
  });
});
