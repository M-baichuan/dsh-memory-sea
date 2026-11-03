import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["../../tests/memory-sea/**/*.test.ts"],
  },
});
