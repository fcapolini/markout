const { defineConfig } = require("vitest/config");

/**
 * Core's own suite: the compiler, the html layer, the runtime, and
 * server-side rendering. Nothing here starts a server, which is the same
 * line the package itself is drawn along.
 */
module.exports = defineConfig({
  test: {
    name: "core",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"]
    }
  }
});
