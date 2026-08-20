const path = require("path");
const { defineConfig } = require("vitest/config");

/**
 * This package's own suite, run either on its own (`npm test -w @markout-lang/cli`) or
 * as one project of the workspace root's run.
 *
 * The alias is why the suite needs no build in front of it: `@markout-lang/core`
 * resolves to core's `main`, which is its BUILT output, and a test run that
 * silently checked the last build rather than the working tree would be
 * worse than a slow one. Source here, dist for anything published -- the
 * same split tsconfig.dev.json makes for `npm run dev`.
 */
module.exports = defineConfig({
  resolve: {
    alias: {
      "@markout-lang/core": path.resolve(__dirname, "../core/src/index.ts"),
      "@markout-lang/express": path.resolve(__dirname, "../express/src/index.ts")
    }
  },
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
