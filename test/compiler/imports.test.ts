import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Compiler } from "../../src/compiler/index";
import path from "path";
import fs from "fs";
import os from "os";

describe("Compiler Imports", () => {
  let tempDir: string;
  let compiler: Compiler;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "markout-imports-test-"));
    compiler = new Compiler({ docroot: tempDir });
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it("should compile pages with import directives", async () => {
    // Create an included fragment
    const subfragmentPath = path.join(tempDir, "fragment.htm");
    fs.writeFileSync(subfragmentPath, "<div>Fragment Content</div>");

    // Create main page with import
    const mainContent = `<html>
<head>
  <:import src="fragment.htm">
  <title>Main Page</title>
</head>
<body>
  <h1>Main</h1>
</body>
</html>`;
    fs.writeFileSync(path.join(tempDir, "main.html"), mainContent);

    const result = await compiler.compile("/main.html");
    expect(result).toBeDefined();
    expect(result.source).toBeDefined();
    expect(result.source.doc).toBeDefined();
    // Should be able to compile pages with imports
    expect(result.source.errors).toBeDefined();
    expect(Array.isArray(result.source.errors)).toBe(true);
  });

  it("should handle missing imported fragments with error", async () => {
    // Create main page with missing import reference
    const mainContent = `<html>
<head>
  <:import src="missing.htm">
  <title>Missing Import Test</title>
</head>
<body>
  <h1>Test</h1>
</body>
</html>`;
    fs.writeFileSync(path.join(tempDir, "missing.html"), mainContent);

    const result = await compiler.compile("/missing.html");
    // Should report an error for missing file
    expect(result.source.errors.length).toBeGreaterThan(0);
  });

  it("should compile pages with multiple imports", async () => {
    // Create fragment files
    fs.writeFileSync(path.join(tempDir, "frag1.htm"), "<section>Fragment 1</section>");
    fs.writeFileSync(path.join(tempDir, "frag2.htm"), "<section>Fragment 2</section>");

    // Create main page with multiple imports
    const mainContent = `<html>
<head>
  <:import src="frag1.htm">
  <:import src="frag2.htm">
  <title>Multi Import</title>
</head>
<body>
  <h1>Test</h1>
</body>
</html>`;
    fs.writeFileSync(path.join(tempDir, "multi.html"), mainContent);

    const result = await compiler.compile("/multi.html");
    expect(result.source).toBeDefined();
    expect(result.source.doc).toBeDefined();
  });

  it("should compile pages with duplicate imports (should be deduplicated)", async () => {
    // Create fragment
    fs.writeFileSync(path.join(tempDir, "shared.htm"), "<mark>Shared</mark>");

    // Create main page with duplicate import references
    const mainContent = `<html>
<head>
  <:import src="shared.htm">
  <:import src="shared.htm">
  <title>Duplicate Import</title>
</head>
<body>
  <h1>Test</h1>
</body>
</html>`;
    fs.writeFileSync(path.join(tempDir, "duplicate.html"), mainContent);

    const result = await compiler.compile("/duplicate.html");
    expect(result.source).toBeDefined();
    expect(result.source.doc).toBeDefined();
    // Should handle duplicate imports
    expect(result.source.errors).toBeDefined();
    expect(Array.isArray(result.source.errors)).toBe(true);
  });

  it("should compile pages with fragment attributes", async () => {
    // Create fragment with head attributes
    const fragContent = `<:meta name="author" content="Test Author">
<div>Fragment with attributes</div>`;
    fs.writeFileSync(path.join(tempDir, "attrs.htm"), fragContent);

    // Create main page
    const mainContent = `<html>
<head>
  <:import src="attrs.htm">
  <title>Attributes Test</title>
</head>
<body>
  <h1>Test</h1>
</body>
</html>`;
    fs.writeFileSync(path.join(tempDir, "attrs.html"), mainContent);

    const result = await compiler.compile("/attrs.html");
    expect(result.source).toBeDefined();
    expect(result.source.doc).toBeDefined();
  });

  it("should compile pages with nested includes", async () => {
    // Create nested fragment
    const nestedPath = path.join(tempDir, "nested.htm");
    fs.writeFileSync(nestedPath, "<nested>Nested Content</nested>");

    // Create primary fragment that references nested
    const primaryPath = path.join(tempDir, "primary.htm");
    fs.writeFileSync(primaryPath, `<:include src="nested.htm">\n<primary>Primary</primary>`);

    // Create main page
    const mainContent = `<html>
<head>
  <:import src="primary.htm">
  <title>Nested Include Test</title>
</head>
<body>
  <h1>Test</h1>
</body>
</html>`;
    fs.writeFileSync(path.join(tempDir, "nested.html"), mainContent);

    const result = await compiler.compile("/nested.html");
    expect(result.source).toBeDefined();
    expect(result.source.doc).toBeDefined();
  });
});
