import { describe, expect, it } from "vitest";
import {
  assertEyeUrlLocal,
  canUseEye,
  isEyeCommand,
  peelEyeSecret,
} from "./eye.js";

describe("isEyeCommand", () => {
  it("matches exact and natural owner asks", () => {
    expect(isEyeCommand("看看外面")).toBe(true);
    expect(isEyeCommand("看一眼")).toBe(true);
    expect(isEyeCommand("你现在可以看看外面了不")).toBe(true);
    expect(isEyeCommand("你现在能看看外边不")).toBe(true);
    expect(isEyeCommand("能不能看外面")).toBe(true);
    expect(isEyeCommand("帮我睁眼看看")).toBe(true);
  });

  it("rejects long/unrelated chat", () => {
    expect(isEyeCommand("外面下雨了我们改天出去玩吧哈哈哈哈哈哈哈哈")).toBe(false);
    expect(isEyeCommand("我发图给你看外面")).toBe(false);
  });
});

describe("peelEyeSecret", () => {
  it("accepts trailing secret and labeled口令", () => {
    const a = peelEyeSecret("看看外面 sea-ok", "sea-ok");
    expect(a.hasIntent).toBe(true);
    expect(a.secretOk).toBe(true);
    expect(a.stripped).toBe("看看外面");

    const b = peelEyeSecret("你现在能看看外边不 口令：sea-ok", "sea-ok");
    expect(b.hasIntent).toBe(true);
    expect(b.secretOk).toBe(true);

    const c = peelEyeSecret("看看外面 wrong", "sea-ok");
    expect(c.hasIntent).toBe(true);
    expect(c.secretOk).toBe(false);
  });
});

describe("canUseEye", () => {
  it("falls back to EYE_OWNER_QQ constant", () => {
    expect(canUseEye("10001")).toBe(true);
    expect(canUseEye("123")).toBe(false);
  });

  it("prefers access.admins[0]", () => {
    const cfg = { access: { admins: ["999888777"], allowUsers: [], allowGroups: [], requireMention: false, triggerNames: [] } } as any;
    expect(canUseEye("999888777", cfg)).toBe(true);
    expect(canUseEye("10001", cfg)).toBe(false);
  });
});

describe("assertEyeUrlLocal", () => {
  it("allows loopback only", () => {
    expect(assertEyeUrlLocal("http://127.0.0.1:8790/snapshot").hostname).toBe(
      "127.0.0.1",
    );
    expect(assertEyeUrlLocal("http://localhost:8790/snapshot").hostname).toBe(
      "localhost",
    );
    expect(() => assertEyeUrlLocal("http://example.com/snapshot")).toThrow(
      /非本机/,
    );
  });
});
