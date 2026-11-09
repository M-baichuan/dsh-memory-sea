import { describe, expect, it } from "vitest";
import { rememberMessageOnce } from "./recent-messages.js";

describe("rememberMessageOnce", () => {
  it("accepts first and rejects duplicate within ttl", () => {
    const key = `t-${Date.now()}-${Math.random()}`;
    expect(rememberMessageOnce(key, 5_000)).toBe(true);
    expect(rememberMessageOnce(key, 5_000)).toBe(false);
  });
});
