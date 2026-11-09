import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { QzoneDraftStore } from "./qzone-draft.js";

describe("QzoneDraftStore", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("keeps drafts per admin", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qzone-draft-"));
    dirs.push(dir);
    const store = new QzoneDraftStore(path.join(dir, "draft.json"));
    store.set({
      content: "A的草稿",
      createdBy: "111",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    store.set({
      content: "B的草稿",
      createdBy: "222",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(store.get("111")?.content).toBe("A的草稿");
    expect(store.get("222")?.content).toBe("B的草稿");
    store.clear("111");
    expect(store.get("111")).toBeNull();
    expect(store.get("222")?.content).toBe("B的草稿");
  });

  it("migrates legacy single draft", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qzone-draft-"));
    dirs.push(dir);
    const file = path.join(dir, "draft.json");
    writeFileSync(
      file,
      JSON.stringify({
        content: "旧草稿",
        createdBy: "10001",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      "utf8",
    );
    const store = new QzoneDraftStore(file);
    expect(store.get("10001")?.content).toBe("旧草稿");
    expect(store.get("999")).toBeNull();
  });
});
