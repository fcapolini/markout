const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"]
    }
  }
});
