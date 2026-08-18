const path = require("path");
const { defineConfig } = require("vitest/config");

/**
 * The alias is the same one packages/cli uses, and for the same reason:
 * `@markout-dev/core` resolves to core's BUILT output, and a suite that checked
 * the last build rather than the working tree would be worse than a slow one.
 */
module.exports = defineConfig({
  resolve: {
    alias: {
      "@markout-dev/core": path.resolve(__dirname, "../core/src/index.ts")
    }
  },
  test: {
    name: "express",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"]
    }
  }
});
