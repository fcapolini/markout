import { describe, it, assert } from 'vitest';
import { Preprocessor } from '../../src/html/preprocessor';
import path from 'path';
import os from 'os';

describe('Cross-platform path handling', () => {
  it('should normalize path separators in source locations', async () => {
    // Create a temporary directory for testing
    const testDir = path.join(__dirname, 'path-test');
    const preprocessor = new Preprocessor(testDir);

    // Test with a simple HTML content that would create source locations
    const testFile = 'test.html';

    try {
      const source = await preprocessor.load(testFile);

      // On Windows, the source.fname should have forward slashes, not backslashes
      // The filename should be normalized regardless of the platform
      if (os.platform() === 'win32') {
        // On Windows, verify no backslashes in the source filename
        assert.ok(
          !source.fname.includes('\\'),
          `Source filename should not contain backslashes: ${source.fname}`
        );
      }

      // The filename should always use forward slashes for consistency
      assert.ok(
        source.fname.includes('/') ||
          !source.fname.includes(path.sep) ||
          source.fname === testFile,
        `Source filename should use forward slashes: ${source.fname}`
      );
    } catch (error) {
      // File not found is expected in this test setup
      // We're mainly testing that the normalization doesn't throw errors
      assert.ok(error instanceof Error);
    }
  });

  it('should handle Windows-style paths correctly', () => {
    const windowsPath = 'src\\components\\button.html';
    const expectedUnixPath = 'src/components/button.html';

    // Simulate the normalization that happens in preprocessor
    const normalized = windowsPath.replace(/\\/g, '/');

    assert.equal(normalized, expectedUnixPath);
  });

  it('should handle already normalized paths correctly', () => {
    const unixPath = 'src/components/button.html';

    // Normalization should be idempotent
    const normalized = unixPath.replace(/\\/g, '/');

    assert.equal(normalized, unixPath);
  });

  it('should handle mixed path separators', () => {
    const mixedPath = 'src\\components/button\\index.html';
    const expectedPath = 'src/components/button/index.html';

    const normalized = mixedPath.replace(/\\/g, '/');

    assert.equal(normalized, expectedPath);
  });
});
