import { describe, expect, it } from "vitest";
import {
  assertivenessLines,
  parseAutonomyDecision,
} from "./autonomy-decide.js";
import { AutonomyPolicy } from "./autonomy-policy.js";
import { pickCandidate, type AutonomyCandidate } from "./autonomy-loop.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("parseAutonomyDecision", () => {
  it("parses clean json", () => {
    const d = parseAutonomyDecision(
      JSON.stringify({ action: "send_text", text: "在吗", reason: "冷场" }),
    );
    expect(d.action).toBe("send_text");
    expect(d.text).toBe("在吗");
  });

  it("parses channel private", () => {
    const d = parseAutonomyDecision(
      '{"action":"send_text","channel":"private","text":"在外面还好吗"}',
    );
    expect(d.action).toBe("send_text");
    expect(d.channel).toBe("private");
  });

  it("parses fenced json and unknown → noop", () => {
    const d = parseAutonomyDecision('好的\n```json\n{"action":"send_sticker","sticker":"无语"}\n```');
    expect(d.action).toBe("send_sticker");
    expect(d.sticker).toBe("无语");
    expect(parseAutonomyDecision("随便聊聊").action).toBe("noop");
  });

  it("normalizes action aliases", () => {
    expect(parseAutonomyDecision('{"action":"SEND-TEXT","message":"hi"}').action).toBe(
      "send_text",
    );
  });

  it("high assertiveness prefers acting language", () => {
    expect(assertivenessLines("high").join("")).toMatch(/优先/);
    expect(assertivenessLines("low").join("")).toMatch(/noop/);
  });
});

describe("AutonomyPolicy", () => {
  it("enforces mute and quota", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-"));
    const policy = new AutonomyPolicy(path.join(dir, "autonomy.json"));
    expect(policy.canAct("group:1", { isPrivate: false, maxPerHour: 2, maxPrivatePerHour: 1 }).ok).toBe(
      true,
    );
    policy.recordAct("group:1");
    policy.recordAct("group:1");
    expect(policy.canAct("group:1", { isPrivate: false, maxPerHour: 2, maxPrivatePerHour: 1 }).ok).toBe(
      false,
    );
    policy.setGlobalMute(true);
    expect(policy.canAct("group:2", { isPrivate: false, maxPerHour: 5, maxPrivatePerHour: 1 }).ok).toBe(
      false,
    );
  });

  it("quiet hours wrap midnight", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto2-"));
    const policy = new AutonomyPolicy(path.join(dir, "a.json"));
    const night = new Date("2026-11-05T02:00:00");
    const noon = new Date("2026-11-05T12:00:00");
    expect(policy.inQuietHours({ startHour: 1, endHour: 8 }, night)).toBe(true);
    expect(policy.inQuietHours({ startHour: 1, endHour: 8 }, noon)).toBe(false);
  });

  it("private idle after human / act", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "auto3-"));
    const policy = new AutonomyPolicy(path.join(dir, "p.json"));
    const uid = "10001";
    expect(policy.privateIdleOk(uid, 30_000)).toBe(true);
    const t0 = Date.now();
    policy.notePrivateHuman(uid, t0);
    expect(policy.privateIdleOk(uid, 60_000, t0 + 10_000)).toBe(false);
    expect(policy.privateIdleOk(uid, 60_000, t0 + 70_000)).toBe(true);
    policy.notePrivateAct(uid, t0 + 70_000);
    expect(policy.msUntilPrivateReady(uid, 60_000, t0 + 80_000)).toBeGreaterThan(0);
  });
});

describe("pickCandidate", () => {
  it("rotates bias between group and private", () => {
    const list: AutonomyCandidate[] = [
      { kind: "group", groupId: "1", idleMs: 100_000 },
      { kind: "private", userId: "10001", idleMs: 100_000 },
    ];
    expect(pickCandidate(list, 0)?.kind).toBe("group");
    expect(pickCandidate(list, 1)?.kind).toBe("private");
  });
});
