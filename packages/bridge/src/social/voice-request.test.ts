import { describe, expect, it } from "vitest";
import { parseDirectSpeakLine, userAskedForVoice } from "./voice-request.js";

describe("userAskedForVoice", () => {
  it("detects common ask phrases", () => {
    expect(userAskedForVoice("用语音回复")).toBe(true);
    expect(userAskedForVoice("发个语音")).toBe(true);
    expect(userAskedForVoice("语音给我说一遍")).toBe(true);
    expect(userAskedForVoice("用语音说我想你了")).toBe(true);
    expect(userAskedForVoice("说一句我想你了")).toBe(true);
  });

  it("ignores normal chat and explicit cancel", () => {
    expect(userAskedForVoice("你好呀")).toBe(false);
    expect(userAskedForVoice("路上小心。")).toBe(false);
    expect(userAskedForVoice("用语音回复吧，不过不用语音了")).toBe(false);
  });
});

describe("parseDirectSpeakLine", () => {
  it("extracts line to speak", () => {
    expect(parseDirectSpeakLine("说一句我想你了")).toBe("我想你了");
    expect(parseDirectSpeakLine("用语音说我想你了")).toBe("我想你了");
    expect(parseDirectSpeakLine("语音说一句晚安")).toBe("晚安");
    expect(parseDirectSpeakLine("念一句「路上小心」")).toBe("路上小心");
    expect(parseDirectSpeakLine("用语音说一句我想你了")).toBe("我想你了");
  });

  it("rejects non-direct lines", () => {
    expect(parseDirectSpeakLine("发个语音")).toBeNull();
    expect(parseDirectSpeakLine("用语音")).toBeNull();
    expect(parseDirectSpeakLine("说一句")).toBeNull();
    expect(parseDirectSpeakLine("用语音回复今天怎么样")).toBeNull();
  });
});
