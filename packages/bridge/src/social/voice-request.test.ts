import { describe, expect, it } from "vitest";
import { userAskedForVoice } from "./voice-request.js";

describe("userAskedForVoice", () => {
  it("detects common ask phrases", () => {
    expect(userAskedForVoice("用语音回复")).toBe(true);
    expect(userAskedForVoice("今天怎么样，语音回复一下")).toBe(true);
    expect(userAskedForVoice("请用语音说说")).toBe(true);
    expect(userAskedForVoice("发个语音")).toBe(true);
  });

  it("ignores normal chat and explicit cancel", () => {
    expect(userAskedForVoice("你好呀")).toBe(false);
    expect(userAskedForVoice("语音识别怎么做")).toBe(false);
    expect(userAskedForVoice("用语音回复吧，不过不用语音了")).toBe(false);
  });
});
