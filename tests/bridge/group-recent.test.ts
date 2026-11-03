import { describe, expect, it } from "vitest";
import { GroupRecentLog } from "../../packages/bridge/src/social/group-recent.js";

describe("GroupRecentLog", () => {
  it("formats others' lines and excludes current user", () => {
    const log = new GroupRecentLog(10);
    log.push("g1", { userId: "a", nickname: "群主", text: "我要背书" });
    log.push("g1", { userId: "b", nickname: "Requiem", text: "我想睡觉" });
    const ctx = log.formatContext("g1", "b");
    expect(ctx).toContain("背书");
    expect(ctx).toContain("群主");
    expect(ctx).toContain("不要当成当前发言人说的");
    expect(ctx).not.toContain("我想睡觉");
  });
});
