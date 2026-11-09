import { describe, expect, it } from "vitest";
import { computeStrength, daysBetween } from "../../packages/memory-sea/src/decay.js";

describe("computeStrength", () => {
  it("decays with active days", () => {
    const fresh = computeStrength({
      importance: 0.8,
      recallCount: 0,
      activeDays: 0,
      baseLambda: 0.02,
    });
    const aged = computeStrength({
      importance: 0.8,
      recallCount: 0,
      activeDays: 40,
      baseLambda: 0.02,
    });
    expect(fresh).toBeGreaterThan(aged);
    expect(fresh).toBeLessThanOrEqual(1);
  });

  it("recall reinforcement increases strength", () => {
    const base = computeStrength({
      importance: 0.6,
      recallCount: 0,
      activeDays: 10,
      baseLambda: 0.02,
    });
    const reinforced = computeStrength({
      importance: 0.6,
      recallCount: 5,
      activeDays: 10,
      baseLambda: 0.02,
    });
    expect(reinforced).toBeGreaterThan(base);
  });

  it("higher importance slows effective lambda", () => {
    const low = computeStrength({
      importance: 0.3,
      recallCount: 0,
      activeDays: 20,
      baseLambda: 0.03,
    });
    const high = computeStrength({
      importance: 0.95,
      recallCount: 0,
      activeDays: 20,
      baseLambda: 0.03,
    });
    expect(high).toBeGreaterThan(low);
  });
});

describe("daysBetween", () => {
  it("returns non-negative day delta", () => {
    expect(
      daysBetween("2026-01-01T00:00:00.000Z", "2026-01-11T00:00:00.000Z"),
    ).toBe(10);
    expect(
      daysBetween("2026-01-11T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
    ).toBe(0);
  });
});
