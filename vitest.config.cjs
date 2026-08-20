const path = require("path");
const { defineConfig } = require("vitest/config");

/**
 * The workspace root's test run: every package's own suite, plus the suites
 * that are about the REPOSITORY rather than about any package.
 *
 * `packages/*` picks up each package's own vitest config, so a package still
 * runs its tests on its own (`npm test -w @markout-lang/cli`) with the same settings it
 * gets here. The inline project below is the other kind: `test/` at the root
 * holds what has no package to belong to -- today the markdown link check,
 * which walks the whole tree including this file's own directory.
 */
module.exports = defineConfig({
  test: {
    projects: [
      "packages/*",
      {
        test: {
          name: "repo",
          root: __dirname,
          include: ["test/**/*.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts"],
    },
  },
});
