import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PresenceStore } from "../../packages/bridge/src/social/presence.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function store(): PresenceStore {
  const dir = mkdtempSync(path.join(os.tmpdir(), "presence-"));
  tmpDirs.push(dir);
  return new PresenceStore(path.join(dir, "presence.json"));
}

describe("PresenceStore", () => {
  it("wakes diving/probed to active on human activity", () => {
    const p = store();
    p.markProbed("g1", 1000);
    expect(p.get("g1").phase).toBe("probed");
    p.noteHumanActivity("g1", 2000);
    expect(p.get("g1").phase).toBe("active");
    expect(p.get("g1").lastHumanAt).toBe(2000);
    expect(p.consumeWakeHint("g1")).toContain("开过话题");

    p.markDiving("g1");
    expect(p.get("g1").phase).toBe("diving");
    p.noteHumanActivity("g1", 3000);
    expect(p.get("g1").phase).toBe("active");
    expect(p.consumeWakeHint("g1")).toContain("潜水");
    expect(p.consumeWakeHint("g1")).toBe("");
  });

  it("plans probe then dive on quiet timelines", () => {
    const p = store();
    const t0 = 1_000_000;
    p.noteHumanActivity("g1", t0);

    expect(
      p.planTicks(["g1"], { idleOpenMs: 10_000, diveAfterProbeMs: 5_000, now: t0 + 9_000 }),
    ).toEqual([]);

    expect(
      p.planTicks(["g1"], { idleOpenMs: 10_000, diveAfterProbeMs: 5_000, now: t0 + 10_000 }),
    ).toEqual([{ groupId: "g1", action: "probe" }]);

    p.markProbed("g1", t0 + 10_000);
    expect(
      p.planTicks(["g1"], {
        idleOpenMs: 10_000,
        diveAfterProbeMs: 5_000,
        now: t0 + 14_999,
      }),
    ).toEqual([]);

    expect(
      p.planTicks(["g1"], {
        idleOpenMs: 10_000,
        diveAfterProbeMs: 5_000,
        now: t0 + 15_000,
      }),
    ).toEqual([{ groupId: "g1", action: "dive" }]);
  });

  it("does not plan probe while diving", () => {
    const p = store();
    p.noteHumanActivity("g1", 0);
    p.markDiving("g1");
    expect(
      p.planTicks(["g1"], { idleOpenMs: 1, diveAfterProbeMs: 1, now: 999_999 }),
    ).toEqual([]);
  });
});
