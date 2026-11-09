import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SessionStore,
  qqSessionKey,
} from "../../packages/bridge/src/dsh/sessions.js";
import { evaluateAccess, shouldTrigger } from "../../packages/bridge/src/access/gate.js";
import { parseAppConfig } from "../../packages/shared/src/config-schema.js";
import { chunkText } from "../../packages/bridge/src/onebot/send.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("qqSessionKey / SessionStore", () => {
  it("isolates private and group keys and persists", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bridge-sess-"));
    dirs.push(dir);
    const file = path.join(dir, "sessions.json");
    const store = new SessionStore(file);
    const key = qqSessionKey({ userId: "1", groupId: "9" });
    expect(key).toBe("group:9:u:1");
    expect(qqSessionKey({ userId: "2", groupId: "9" })).toBe("group:9:u:2");
    store.set({
      qqKey: key,
      sessionId: "s1",
      title: "群 9",
      updatedAt: new Date().toISOString(),
    });
    const again = new SessionStore(file);
    expect(again.get(key)?.sessionId).toBe("s1");
    expect(qqSessionKey({ userId: "1" })).toBe("private:1");
  });
});

describe("access gate", () => {
  it("denies unknown private users when allowlist is set", () => {
    const cfg = parseAppConfig({
      access: { admins: ["admin"], allowUsers: ["u1"], allowGroups: [], requireMention: true },
    });
    const denied = evaluateAccess(cfg, {
      userId: "stranger",
      rawText: "hi",
      isAtSelf: false,
    });
    expect(denied.allow).toBe(false);
    const allowed = evaluateAccess(cfg, {
      userId: "u1",
      rawText: "hi",
      isAtSelf: false,
    });
    expect(allowed.allow).toBe(true);
  });

  it("requires mention or trigger name in groups", () => {
    const cfg = parseAppConfig({
      access: {
        admins: [],
        allowUsers: [],
        allowGroups: [],
        requireMention: true,
        triggerNames: ["鲸鱼娘"],
      },
    });
    expect(
      shouldTrigger(cfg, {
        userId: "1",
        groupId: "2",
        rawText: "大家好",
        isAtSelf: false,
      }),
    ).toBe(false);
    expect(
      shouldTrigger(cfg, {
        userId: "1",
        groupId: "2",
        rawText: "鲸鱼娘在吗",
        isAtSelf: false,
      }),
    ).toBe(true);
  });
});

describe("chunkText", () => {
  it("splits long replies", () => {
    const parts = chunkText("a".repeat(50) + "\n" + "b".repeat(50), 40);
    expect(parts.length).toBeGreaterThan(1);
  });
});
