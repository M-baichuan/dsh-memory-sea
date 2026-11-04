import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemorySea } from "../../packages/memory-sea/src/engine.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function sea() {
  const dir = mkdtempSync(path.join(tmpdir(), "memory-sea-vis-"));
  dirs.push(dir);
  return new MemorySea({ dbPath: path.join(dir, "sea.sqlite") });
}

describe("visibility isolation (mind-sea style)", () => {
  it("does not recall private memories in group channel", () => {
    const m = sea();
    m.remember(
      { kind: "user", userId: "u1" },
      {
        content: "我不吃香菜",
        category: "preference",
        importance: 0.9,
        confidence: 0.9,
        visibility: "private",
      },
    );

    const privateHits = m.recall({ kind: "user", userId: "u1" }, "香菜", {
      context: { channel: "private", userId: "u1" },
    });
    expect(privateHits.some((e) => e.content.includes("香菜"))).toBe(true);

    const groupHits = m.recall({ kind: "user", userId: "u1" }, "香菜", {
      context: { channel: "group", groupId: "g1", userId: "u1" },
    });
    expect(groupHits.some((e) => e.content.includes("香菜"))).toBe(false);
    m.close();
  });

  it("group visibility only matches same groupId", () => {
    const m = sea();
    m.remember(
      { kind: "group", groupId: "g1" },
      {
        content: "本群周五团建",
        category: "event",
        importance: 0.8,
        confidence: 0.9,
        visibility: "group",
        groupId: "g1",
      },
    );
    const same = m.recall({ kind: "group", groupId: "g1" }, "团建", {
      context: { channel: "group", groupId: "g1" },
    });
    const other = m.recall({ kind: "group", groupId: "g1" }, "团建", {
      context: { channel: "group", groupId: "g2" },
    });
    expect(same).toHaveLength(1);
    expect(other).toHaveLength(0);
    m.close();
  });
});

describe("pin", () => {
  it("pinned memories survive maintenance prune while weak unpinned ones do not", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "memory-sea-pin-"));
    dirs.push(dir);
    const m = new MemorySea({
      dbPath: path.join(dir, "sea.sqlite"),
      config: { pruneThreshold: 0.5 },
    });
    const pinnedId = m.remember(
      { kind: "user", userId: "u1" },
      {
        content: "钉住的底色：叫我Alice",
        category: "identity",
        importance: 0.2,
        confidence: 0.9,
        pin: true,
      },
    );
    const weakId = m.remember(
      { kind: "user", userId: "u1" },
      {
        content: "随便一句噪声",
        category: "chat_noise",
        importance: 0.2,
        confidence: 0.8,
        pin: false,
      },
    );
    m.runMaintenance();
    expect(m.get(pinnedId)?.status).toBe("active");
    expect(m.get(pinnedId)?.pin).toBe(true);
    expect(m.get(weakId)?.status).toBe("pruned");
    m.close();
  });
});
