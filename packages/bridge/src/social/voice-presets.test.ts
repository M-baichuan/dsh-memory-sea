import { describe, expect, it } from "vitest";
import { matchVoicePreset } from "./voice-presets.js";
import { isVoiceAdminCommand } from "./voice-admin.js";

describe("matchVoicePreset", () => {
  it("matches id / alias / edge id", () => {
    expect(matchVoicePreset("晓伊")?.edge).toBe("zh-CN-XiaoyiNeural");
    expect(matchVoicePreset("柔声")?.id).toBe("晓伊");
    expect(matchVoicePreset("zh-CN-YunxiNeural")?.id).toBe("云希");
    expect(matchVoicePreset("东北")?.id).toBe("晓北");
    expect(matchVoicePreset("可莉")?.pitch).toBe("+92Hz");
    expect(matchVoicePreset("萝莉")?.id).toBe("萝莉");
    expect(matchVoicePreset("火花骑士")?.id).toBe("可莉");
    expect(matchVoicePreset("奶声")?.pitch).toBe("+105Hz");
  });
});

describe("isVoiceAdminCommand", () => {
  it("matches list and switch", () => {
    expect(isVoiceAdminCommand("/配音")).toBe(true);
    expect(isVoiceAdminCommand("音色")).toBe(true);
    expect(isVoiceAdminCommand("/配音 晓伊")).toBe(true);
    expect(isVoiceAdminCommand("音色 柔声")).toBe(true);
    expect(isVoiceAdminCommand("你好")).toBe(false);
  });
});
