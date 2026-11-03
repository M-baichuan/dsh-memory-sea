import path from "node:path";
import type { AppConfig } from "@dsh-memory-sea/shared";
import type { DshApiClient } from "../dsh/api-client.js";
import type { SessionStore } from "../dsh/sessions.js";
import { qqSessionKey } from "../dsh/sessions.js";
import type { OneBotClient } from "../onebot/client.js";
import { deliverReply } from "../pipeline/egress.js";
import type { PresenceStore } from "./presence.js";
import type { StickerEntry } from "./stickers.js";

export interface PresenceLoopDeps {
  cfg: AppConfig;
  root: string;
  presence: PresenceStore;
  sessions: SessionStore;
  dsh: DshApiClient;
  client: OneBotClient;
  systemPromptRef: { current: string };
  stickersRef: { current: StickerEntry[] };
}

let probeCursor = 0;

export function pickProactivePrompt(cfg: AppConfig["social"]): string {
  const pool = (cfg.proactivePromptPool || []).filter((s) => s.trim());
  if (pool.length) {
    const text = pool[probeCursor % pool.length]!;
    probeCursor += 1;
    return text;
  }
  return cfg.proactivePrompt;
}

export function startPresenceLoop(deps: PresenceLoopDeps): () => void {
  const { cfg } = deps;
  if (!cfg.social.enabled) return () => undefined;

  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const groups = cfg.access.allowGroups.filter(Boolean);
      if (!groups.length) return;
      const actions = deps.presence.planTicks(groups, {
        idleOpenMs: cfg.social.idleOpenMs,
        diveAfterProbeMs: cfg.social.diveAfterProbeMs,
      });
      for (const action of actions) {
        if (stopped) break;
        if (action.action === "dive") {
          deps.presence.markDiving(action.groupId);
          console.log(`[bridge] presence dive group=${action.groupId}`);
          continue;
        }
        try {
          await runProbe(deps, action.groupId);
          deps.presence.markProbed(action.groupId);
          console.log(`[bridge] presence probe group=${action.groupId}`);
        } catch (err) {
          console.warn(
            `[bridge] presence probe failed group=${action.groupId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, cfg.social.tickMs);
  void tick();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function runProbe(deps: PresenceLoopDeps, groupId: string): Promise<void> {
  const qqKey = qqSessionKey({ userId: "presence", groupId });
  const title = `群 ${groupId}`;
  const systemPrompt = deps.systemPromptRef.current;
  let mapping = deps.sessions.get(qqKey);
  if (!mapping) {
    const sessionId = await deps.dsh.ensureSession({
      key: qqKey,
      title,
      systemPrompt,
    });
    mapping = {
      qqKey,
      sessionId,
      title,
      updatedAt: new Date().toISOString(),
    };
    deps.sessions.set(mapping);
  }

  const probeMsg =
    `【人设·勿复述】\n${systemPrompt.trim()}\n\n` +
    pickProactivePrompt(deps.cfg.social);
  const result = await deps.dsh.prompt({
    sessionId: mapping.sessionId,
    message: probeMsg,
    systemPrompt,
  });

  const stickerDir = path.isAbsolute(deps.cfg.social.stickerDir)
    ? deps.cfg.social.stickerDir
    : path.join(deps.root, deps.cfg.social.stickerDir);

  await deliverReply(deps.client, {
    userId: deps.cfg.onebot.selfId || "0",
    groupId,
    text: result.text || "……有人在吗？",
    chunkLimit: deps.cfg.bridge.textChunkLimit,
    stickerDir,
    stickers: deps.stickersRef.current,
    social: deps.cfg.social,
  });

  mapping.updatedAt = new Date().toISOString();
  deps.sessions.set(mapping);
}
