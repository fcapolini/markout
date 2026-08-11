const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"]
  }
});
