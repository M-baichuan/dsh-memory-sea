import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["../../tests/bridge/**/*.test.ts", "src/**/*.test.ts"],
  },
});
