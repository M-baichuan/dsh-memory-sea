import path from "node:path";
import type { AppConfig } from "@dsh-memory-sea/shared";
import { MemorySea } from "@dsh-memory-sea/memory-sea";
import { evaluateAccess, shouldTrigger } from "../access/gate.js";
import type { DshApiClient } from "../dsh/api-client.js";
import { SessionStore, qqSessionKey } from "../dsh/sessions.js";
import type { OneBotClient, OneBotEvent } from "../onebot/client.js";
import {
  extractImages,
  formatImageHint,
  prepareVisionImages,
} from "../onebot/media.js";
import { extractText, isAtSelf } from "../onebot/send.js";
import { handlePersonaAdmin } from "../social/persona-admin.js";
import type { PersonaCardStore } from "../social/persona-cards.js";
import type { PersonaRuntime } from "../social/persona-runtime.js";
import type { GroupRecentLog } from "../social/group-recent.js";
import type { PresenceStore } from "../social/presence.js";
import { handleStickerCollect } from "../social/sticker-collect.js";
import type { StickerEntry } from "../social/stickers.js";
import { userAskedForVoice } from "../social/voice-request.js";
import { buildMemoryPrefix, composePromptWithPersona } from "./memory-inject.js";
import { deliverReply } from "./egress.js";

export interface IngressContext {
  cfg: AppConfig;
  sea: MemorySea;
  dsh: DshApiClient;
  sessions: SessionStore;
  client: OneBotClient;
  /** @deprecated prefer systemPromptRef / personaRuntime */
  systemPrompt: string;
  systemPromptRef: { current: string };
  personaRuntime?: PersonaRuntime;
  root: string;
  presence?: PresenceStore;
  stickersRef: { current: StickerEntry[] };
  personaCards?: PersonaCardStore;
  groupRecent?: GroupRecentLog;
}

function activeSystemPrompt(ctx: IngressContext): string {
  return ctx.systemPromptRef?.current ?? ctx.systemPrompt;
}

export async function handleOneBotMessage(
  ctx: IngressContext,
  event: OneBotEvent,
): Promise<void> {
  const userId = String(event.user_id ?? event.sender?.user_id ?? "");
  if (!userId) return;
  const selfId = String(event.self_id ?? ctx.cfg.onebot.selfId ?? "");
  if (selfId && userId === selfId) return;

  const groupId =
    event.message_type === "group" ? String(event.group_id ?? "") : undefined;
  const rawText = extractText(event);
  const images = extractImages(event);
  if (!rawText && !images.length) return;

  const nickname = event.sender?.nickname
    ? String(event.sender.nickname)
    : `QQ${userId}`;

  const incoming = {
    userId,
    groupId: groupId || undefined,
    rawText: rawText || "[图片]",
    isAtSelf: isAtSelf(event),
  };

  if (groupId && ctx.cfg.social.enabled && ctx.presence) {
    const allowed =
      ctx.cfg.access.allowGroups.length === 0 ||
      ctx.cfg.access.allowGroups.includes(groupId);
    if (allowed) {
      ctx.presence.noteHumanActivity(groupId);
      ctx.groupRecent?.push(groupId, {
        userId,
        nickname,
        text: (rawText || "[图片]").slice(0, 120),
      });
    }
  }

  const access = evaluateAccess(ctx.cfg, incoming);
  if (!access.allow) {
    if (access.reply) {
      await deliverReply(ctx.client, {
        userId,
        groupId,
        text: access.reply,
        chunkLimit: ctx.cfg.bridge.textChunkLimit,
        ...deliverExtras(ctx),
      });
    }
    return;
  }

  const collect = await handleStickerCollect({
    cfg: ctx.cfg,
    root: ctx.root,
    client: ctx.client,
    event,
    userId,
    stickersRef: ctx.stickersRef,
  });
  if (collect.handled) {
    await deliverReply(ctx.client, {
      userId,
      groupId,
      text: collect.reply,
      chunkLimit: ctx.cfg.bridge.textChunkLimit,
      ...deliverExtras(ctx),
    });
    return;
  }

  if (ctx.personaRuntime) {
    const personaCmd = await handlePersonaAdmin({
      cfg: ctx.cfg,
      userId,
      text: rawText,
      runtime: ctx.personaRuntime,
    });
    if (personaCmd.handled) {
      await deliverReply(ctx.client, {
        userId,
        groupId,
        text: personaCmd.reply,
        chunkLimit: ctx.cfg.bridge.textChunkLimit,
        ...deliverExtras(ctx),
      });
      return;
    }
  }

  if (!shouldTrigger(ctx.cfg, incoming) && !images.length) return;
  // Image-only in group still needs trigger unless requireMention is false.
  if (!shouldTrigger(ctx.cfg, incoming)) return;

  if (ctx.cfg.social.personaCardsEnabled && ctx.personaCards) {
    ctx.personaCards.learnFromUtterance(
      userId,
      rawText,
      event.sender?.nickname ? String(event.sender.nickname) : undefined,
    );
  }

  void ctx.sea.ingestUtterance(
    groupId
      ? { kind: "relation", userId, groupId }
      : { kind: "user", userId },
    rawText || "[图片]",
    {
      ownerId: userId,
      groupId: groupId || undefined,
      visibility: groupId ? "group" : "private",
    },
  );

  const { block, evidenceIds } = buildMemoryPrefix(ctx.sea, ctx.cfg, {
    userId,
    groupId,
    query: rawText || "图片",
  });

  const extras: string[] = [];
  if (ctx.cfg.social.personaCardsEnabled && ctx.personaCards) {
    const card = ctx.personaCards.formatForInject(userId);
    if (card) extras.push(card);
  }
  if (groupId && ctx.cfg.social.wakeContextEnabled && ctx.presence) {
    const wake = ctx.presence.consumeWakeHint(groupId);
    if (wake) extras.push(`【情境】${wake}`);
  }
  let visionParts: Array<{ mediaType: string; data: string; name: string }> = [];
  if (images.length) {
    const cacheDir = path.join(ctx.root, "data", "cache", "incoming");
    const prepared = await prepareVisionImages(images, {
      cacheDir,
      client: ctx.client,
    });
    visionParts = prepared.parts;
    extras.push(formatImageHint(prepared.saved, visionParts.length > 0));
    if (visionParts.length) {
      console.log(`[bridge] vision images attached count=${visionParts.length}`);
    } else {
      console.warn("[bridge] vision images failed to download");
    }
  }

  if (groupId && ctx.groupRecent) {
    const others = ctx.groupRecent.formatContext(groupId, userId);
    if (others) extras.push(others);
  }

  const memoryBlock = [block, ...extras].filter(Boolean).join("\n\n");
  const systemPrompt = activeSystemPrompt(ctx);
  const payload = composePromptWithPersona(
    systemPrompt,
    memoryBlock,
    rawText || (visionParts.length ? "（发了图片，请直接看图）" : "（发了一张图片）"),
    { userId, nickname, groupId },
  );
  const qqKey = qqSessionKey({ userId, groupId });
  const title = groupId ? `群 ${groupId} · ${nickname}` : `私聊 ${nickname}`;

  let mapping = ctx.sessions.get(qqKey);
  if (!mapping) {
    const shouldLockModel =
      ctx.cfg.dsh.lockModel && Boolean(ctx.cfg.dsh.model?.trim());
    let sessionId: string;
    try {
      sessionId = await ctx.dsh.ensureSession({
        key: qqKey,
        title,
        model: shouldLockModel ? ctx.cfg.dsh.model.trim() : undefined,
        provider: shouldLockModel ? ctx.cfg.dsh.provider?.trim() || undefined : undefined,
        systemPrompt,
      });
    } catch (err) {
      console.error(
        "[bridge] ensureSession failed:",
        err instanceof Error ? err.message : err,
      );
      await deliverReply(ctx.client, {
        userId,
        groupId,
        text:
          `（DSH 建会话失败）${err instanceof Error ? err.message : String(err)}\n` +
          `请确认桌面端仍开着，且 config.json 的 dsh.baseUrl 端口正确。`,
        chunkLimit: ctx.cfg.bridge.textChunkLimit,
        ...deliverExtras(ctx),
      });
      return;
    }
    mapping = {
      qqKey,
      sessionId,
      title,
      updatedAt: new Date().toISOString(),
    };
    ctx.sessions.set(mapping);
  }

  const result = await ctx.dsh.prompt({
    sessionId: mapping.sessionId,
    message: payload,
    systemPrompt,
    images: visionParts,
  });

  if (evidenceIds.length) ctx.sea.reinforce(evidenceIds);

  await deliverReply(ctx.client, {
    userId,
    groupId,
    text: result.text || "……",
    chunkLimit: ctx.cfg.bridge.textChunkLimit,
    atSender: Boolean(groupId && incoming.isAtSelf),
    preferVoice: userAskedForVoice(rawText),
    ...deliverExtras(ctx),
  });

  mapping.updatedAt = new Date().toISOString();
  ctx.sessions.set(mapping);
}

function deliverExtras(ctx: IngressContext): {
  stickerDir?: string;
  stickers?: StickerEntry[];
  social?: AppConfig["social"];
} {
  if (!ctx.cfg.social.enabled) return { social: ctx.cfg.social };
  const stickerDir = path.isAbsolute(ctx.cfg.social.stickerDir)
    ? ctx.cfg.social.stickerDir
    : path.join(ctx.root, ctx.cfg.social.stickerDir);
  return {
    stickerDir,
    stickers: ctx.stickersRef.current,
    social: ctx.cfg.social,
  };
}
