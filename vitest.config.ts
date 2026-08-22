import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 60000,
    // Performance-sensitive suites are tagged and run separately by npm run bench.
    exclude: ["tests/bench/**", "node_modules/**", "dist/**"],
  },
});
