import { defineConfig } from "vitest/config";

// Scoped to the dashboard web app so it doesn't inherit the repo-root config
// (which only globs tests/unit/**). Auth-core tests live next to the source.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    root: __dirname,
  },
});
