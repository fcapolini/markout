const { defineConfig } = require("vitest/config");

/**
 * This package's own suite, run either on its own (`npm test -w markout`) or
 * as one project of the workspace root's run -- the root config names this
 * directory rather than restating any of it, so the two cannot disagree.
 *
 * The coverage block is only used by the first of those: run from the root,
 * coverage is a whole-run setting and the root's own block owns it.
 */
module.exports = defineConfig({
  test: {
    name: "markout",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"]
    }
  }
});
