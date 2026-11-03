#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseAppConfig } from "@dsh-memory-sea/shared";
import { MemorySea } from "@dsh-memory-sea/memory-sea";
import { OneBotClient } from "./onebot/client.js";
import { DshApiClient } from "./dsh/api-client.js";
import { SessionStore } from "./dsh/sessions.js";
import { handleOneBotMessage } from "./pipeline/ingress.js";
import { handlePoke } from "./pipeline/poke.js";
import { GroupRecentLog } from "./social/group-recent.js";
import { PersonaCardStore } from "./social/persona-cards.js";
import { PersonaRuntime } from "./social/persona-runtime.js";
import { PresenceStore } from "./social/presence.js";
import { startPresenceLoop } from "./social/presence-loop.js";
import { listStickers, stickerHintForPrompt } from "./social/stickers.js";
import { resolveRepoRoot, statePaths } from "./state/paths.js";

export { OneBotClient } from "./onebot/client.js";
export { SessionStore, qqSessionKey } from "./dsh/sessions.js";
export { evaluateAccess, shouldTrigger } from "./access/gate.js";
export {
  buildMemoryPrefix,
  composeUserPayload,
  composePromptWithPersona,
} from "./pipeline/memory-inject.js";
export { parseStickerTags, listStickers } from "./social/stickers.js";
export { PresenceStore } from "./social/presence.js";
export { splitBubbles, typingDelayMs } from "./pipeline/bubbles.js";

export interface BridgeHandle {
  start(): void;
  stop(): void;
}

export async function createBridge(root = resolveRepoRoot()): Promise<BridgeHandle> {
  const paths = statePaths(root);
  const raw = JSON.parse(await readFile(paths.config, "utf8")) as unknown;
  const cfg = parseAppConfig(raw);

  const sea = new MemorySea({
    dbPath: path.resolve(root, cfg.memory.dbPath),
    config: cfg.memory,
  });

  const stickerDir = path.isAbsolute(cfg.social.stickerDir)
    ? cfg.social.stickerDir
    : path.join(root, cfg.social.stickerDir);
  mkdirSync(stickerDir, { recursive: true });
  mkdirSync(path.join(root, "data", "cache", "incoming"), { recursive: true });

  const stickersRef = { current: listStickers(stickerDir) };
  const personaCards = new PersonaCardStore(paths.personaCards);

  const personaRuntime = await PersonaRuntime.create({
    root,
    statePath: paths.personaActive,
    contentDir: path.resolve(root, cfg.persona.contentDir),
    personaId: cfg.persona.id,
    defaultPreset: cfg.persona.preset || "",
    presetsDir: cfg.persona.presetsDir || undefined,
    buildSuffix: () =>
      cfg.social.enabled
        ? stickerHintForPrompt(
            stickersRef.current,
            Boolean(cfg.social.tts?.enabled),
            cfg.social.tts?.replyMode ?? "ask",
          )
        : "",
  });
  const systemPromptRef = personaRuntime.systemPromptRef;

  const client = new OneBotClient({
    wsUrl: cfg.onebot.wsUrl,
    accessToken: cfg.onebot.accessToken || undefined,
    selfId: cfg.onebot.selfId || undefined,
  });
  const dsh = new DshApiClient({
    baseUrl: cfg.dsh.baseUrl,
    cookie: cfg.dsh.cookie || undefined,
    autoMintCookie: cfg.dsh.autoMintCookie,
    workspaceTitle: cfg.dsh.workspaceGroup,
    workspacePath: path.resolve(root, "data", "agents"),
  });
  const auth = dsh.refreshAuth();
  if (auth.ok) {
    console.log(`[bridge] DSH Host auth ready (${auth.source}) → ${cfg.dsh.baseUrl}`);
  } else {
    console.warn(
      `[bridge] DSH Host auth NOT ready (${auth.detail ?? "unknown"}). Desktop will return 401 until fixed.`,
    );
  }
  const health = await dsh.health();
  if (!health.ok) {
    console.warn(
      `[bridge] DSH health check failed status=${health.status ?? "?"} auth=${health.auth ?? "?"}`,
    );
  } else {
    console.log(`[bridge] DSH health ok status=${health.status}`);
  }

  const sessions = new SessionStore(paths.sessions);
  // Drop legacy shared group:* sessions (pre per-user keys) to stop speaker mix-ups.
  for (const row of sessions.list()) {
    if (/^group:\d+$/.test(row.qqKey)) sessions.delete(row.qqKey);
  }
  const presence = new PresenceStore(paths.presence);
  const groupRecent = new GroupRecentLog(16);

  const ctx = {
    cfg,
    sea,
    dsh,
    sessions,
    client,
    systemPrompt: systemPromptRef.current,
    systemPromptRef,
    personaRuntime,
    root,
    presence,
    stickersRef,
    personaCards,
    groupRecent,
  };

  client.on("open", () => console.log(`[bridge] OneBot connected ${cfg.onebot.wsUrl}`));
  client.on("close", () => console.warn("[bridge] OneBot disconnected; reconnecting…"));
  client.on("error", (err: Error) => console.error("[bridge] OneBot error", err.message));
  client.on("message", (event) => {
    void handleOneBotMessage(ctx, event).catch((err) => {
      console.error("[bridge] message handler failed", err);
    });
  });
  client.on("event", (event) => {
    void handlePoke({
      cfg,
      client,
      event,
      root,
      stickers: stickersRef.current,
    }).catch((err) => {
      console.error("[bridge] poke handler failed", err);
    });
  });

  let stopPresence: () => void = () => {};

  return {
    start() {
      client.start();
      stopPresence = startPresenceLoop({
        cfg,
        root,
        presence,
        sessions,
        dsh,
        client,
        systemPromptRef,
        stickersRef,
      });
      console.log(
        `[bridge] started (persona=${personaRuntime.currentPresetId ?? cfg.persona.id}, stickers=${stickersRef.current.length}, social=${cfg.social.enabled})`,
      );
    },
    stop() {
      stopPresence();
      client.stop();
      sea.close();
      console.log("[bridge] stopped");
    },
  };
}

async function main() {
  const bridge = await createBridge();
  bridge.start();
  const shutdown = () => {
    bridge.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]).includes(`${path.sep}bridge${path.sep}`);

if (isDirect || process.argv[1]?.endsWith("index.js")) {
  if (process.env.DSH_MEMORY_SEA_BRIDGE_NO_AUTO !== "1") {
    main().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
