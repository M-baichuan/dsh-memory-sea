import { describe, expect, it } from "vitest";
import { planConsolidations } from "../../packages/memory-sea/src/consolidate.js";
import type { StoredMemory } from "../../packages/memory-sea/src/store/types.js";

function row(partial: Partial<StoredMemory> & Pick<StoredMemory, "id" | "content">): StoredMemory {
  return {
    scope_key: "user:1",
    category: "fact",
    importance: 0.7,
    confidence: 0.8,
    recall_count: 0,
    status: "active",
    tags_json: "[]",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    last_recalled_at: null,
    active_days_anchor: "2026-01-01T00:00:00.000Z",
    consolidated_into: null,
    ...partial,
  };
}

describe("planConsolidations", () => {
  it("merges near-duplicate memories and keeps the stronger one", () => {
    const plans = planConsolidations([
      row({ id: "a", content: "我喜欢吃鱼", importance: 0.6 }),
      row({ id: "b", content: "我喜欢吃鱼", importance: 0.9, recall_count: 2 }),
      row({ id: "c", content: "完全不相关的事", importance: 0.5 }),
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.keepId).toBe("b");
    expect(plans[0]!.archiveIds).toContain("a");
  });
});
