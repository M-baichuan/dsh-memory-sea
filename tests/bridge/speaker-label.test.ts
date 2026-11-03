import { describe, expect, it } from "vitest";
import {
  composeUserPayload,
  formatSpeakerLabel,
} from "../../packages/bridge/src/pipeline/memory-inject.js";

describe("speaker labeling", () => {
  it("labels group speakers with nickname and qq", () => {
    expect(
      formatSpeakerLabel({ userId: "180108719", nickname: "Requiem", groupId: "1" }),
    ).toContain("Requiem");
    expect(
      formatSpeakerLabel({ userId: "180108719", nickname: "Requiem", groupId: "1" }),
    ).toContain("180108719");
  });

  it("puts current speaker guard in payload", () => {
    const text = composeUserPayload("", "小鱼", {
      userId: "180108719",
      nickname: "Requiem",
      groupId: "1130480362",
    });
    expect(text).toContain("当前发言人");
    expect(text).toContain("Requiem");
    expect(text).toContain("不要把上一条其他群友的话当成他/她说的");
    expect(text).toContain("小鱼");
  });
});
