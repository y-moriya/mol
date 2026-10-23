import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@agentlore/security-core": resolve(__dirname, "packages/security-core/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
