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
import { handleEyeLook, resolveOwnerQq } from "../social/eye.js";
import { handleEyeVaultAdmin } from "../social/eye-vault-admin.js";
import type { EyeVault } from "../social/eye-vault.js";
import { handlePromiseCommand, type PromiseStore } from "../social/promises.js";
import { handleQzoneAdmin } from "../social/qzone-admin.js";
import type { QzoneDraftStore } from "../social/qzone-draft.js";
import { handleRecallSlice, isRecallSliceCommand } from "../social/recall-slice.js";
import { formatSkillsMenu, isSkillsMenuCommand } from "../social/skills-menu.js";
import { handleStickerCollect } from "../social/sticker-collect.js";
import { handleStickerDirector } from "../social/sticker-director.js";
import type { StickerEntry } from "../social/stickers.js";
import {
  handleTasteMapCommand,
  type TasteMapStore,
} from "../social/taste-map.js";
import { handleKnowledgeAdmin } from "../social/knowledge-admin.js";
import type { KnowledgeBase } from "../social/knowledge-base.js";
import { handleAutonomyAdmin } from "../social/autonomy-admin.js";
import type { AutonomyPolicy } from "../social/autonomy-policy.js";
import { handleOwnerHowto } from "../social/owner-howto.js";
import { handleVoiceAdmin } from "../social/voice-admin.js";
import { parseDirectSpeakLine, userAskedForVoice } from "../social/voice-request.js";
import type { VoiceRuntime } from "../social/voice-runtime.js";
import { parseWhisper, whisperGroupAck } from "../social/whisper.js";
import { buildMemoryPrefix, composePromptWithPersona } from "./memory-inject.js";
import { deliverNotice, deliverReply } from "./egress.js";
import { rememberMessageOnce } from "./recent-messages.js";

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
  voiceRuntime?: VoiceRuntime;
  voiceRef?: { current: { edge: string; rate: string; pitch: string } };
  root: string;
  presence?: PresenceStore;
  stickersRef: { current: StickerEntry[] };
  personaCards?: PersonaCardStore;
  groupRecent?: GroupRecentLog;
  qzoneDrafts?: QzoneDraftStore;
  promises?: PromiseStore;
  tasteMap?: TasteMapStore;
  eyeVault?: EyeVault;
  knowledge?: KnowledgeBase;
  autonomyPolicy?: AutonomyPolicy;
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

  const messageId = event.message_id != null ? String(event.message_id) : "";
  if (messageId && !rememberMessageOnce(`mid:${messageId}`, 120_000)) {
    console.warn(`[bridge] drop duplicate message_id=${messageId}`);
    return;
  }

  const groupId =
    event.message_type === "group" ? String(event.group_id ?? "") : undefined;
  const rawText = extractText(event);
  const images = extractImages(event);
  if (!rawText && !images.length) return;

  // Same user+text within 3s (even if message_id differs) — kills double fan-out.
  const burstKey = `burst:${groupId || "p"}:${userId}:${rawText.slice(0, 120)}:${images.length}`;
  if (!rememberMessageOnce(burstKey, 3_000)) {
    console.warn(`[bridge] drop duplicate burst ${burstKey.slice(0, 80)}`);
    return;
  }

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
      await deliverNotice(ctx.client, {
        userId,
        groupId,
        text: access.reply,
        chunkLimit: ctx.cfg.bridge.textChunkLimit,
      });
    }
    return;
  }

  // Owner private chat resets autonomy DM idle (so she won't poke right after you reply).
  if (!groupId && userId === resolveOwnerQq(ctx.cfg) && ctx.autonomyPolicy) {
    ctx.autonomyPolicy.notePrivateHuman(userId);
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
    await deliverNotice(ctx.client, {
      userId,
      groupId,
      text: collect.reply,
      chunkLimit: ctx.cfg.bridge.textChunkLimit,
    });
    return;
  }

  // Owner private cheat-sheet: 教程 眼睛 / 怎么用知识库.
  // Unknown feature → silent (no reply, no chat fallthrough).
  {
    const howto = handleOwnerHowto({ userId, groupId, text: rawText, cfg: ctx.cfg });
    if (howto.handled) {
      if ("reply" in howto && howto.reply) {
        await deliverNotice(ctx.client, {
          userId,
          groupId,
          text: howto.reply,
          chunkLimit: ctx.cfg.bridge.textChunkLimit,
        });
      }
      return;
    }
  }

  if (ctx.personaRuntime) {
    const personaCmd = await handlePersonaAdmin({
      cfg: ctx.cfg,
      userId,
      text: rawText,
      runtime: ctx.personaRuntime,
    });
    if (personaCmd.handled) {
      await deliverNotice(ctx.client, {
        userId,
        groupId,
        text: personaCmd.reply,
        chunkLimit: ctx.cfg.bridge.textChunkLimit,
      });
      return;
    }
  }

  if (ctx.voiceRuntime) {
    const voiceCmd = handleVoiceAdmin({
      cfg: ctx.cfg,
      userId,
      text: rawText,
      runtime: ctx.voiceRuntime,
    });
    if (voiceCmd.handled) {
      await deliverNotice(ctx.client, {
        userId,
        groupId,
        text: voiceCmd.reply,
        chunkLimit: ctx.cfg.bridge.textChunkLimit,
      });
      return;
    }
  }

  if (ctx.qzoneDrafts) {
    const qzoneCmd = await handleQzoneAdmin({
      cfg: ctx.cfg,
      userId,
      text: rawText,
      client: ctx.client,
      dsh: ctx.dsh,
      sessions: ctx.sessions,
      systemPrompt: activeSystemPrompt(ctx),
      drafts: ctx.qzoneDrafts,
      sea: ctx.sea,
    });
    if (qzoneCmd.handled) {
      await deliverNotice(ctx.client, {
        userId,
        groupId,
        text: qzoneCmd.reply,
        chunkLimit: ctx.cfg.bridge.textChunkLimit,
      });
      return;
    }
  }

  const skills = ctx.cfg.social.skills ?? {};

  if (isSkillsMenuCommand(rawText)) {
    await deliverNotice(ctx.client, {
      userId,
      groupId,
      text: formatSkillsMenu(),
      chunkLimit: ctx.cfg.bridge.textChunkLimit,
    });
    return;
  }

  if (skills.stickerDirector !== false) {
    const stickerDir = await handleStickerDirector({
      client: ctx.client,
      userId,
      groupId,
      text: rawText,
      stickers: ctx.stickersRef.current,
      chunkLimit: ctx.cfg.bridge.textChunkLimit,
    });
    if (stickerDir.handled) {
      if (stickerDir.reply) {
        await deliverNotice(ctx.client, {
          userId,
          groupId,
          text: stickerDir.reply,
          chunkLimit: ctx.cfg.bridge.textChunkLimit,
        });
      }
      return;
    }
  }

  if (skills.promises !== false && ctx.promises) {
    const promiseCmd = handlePromiseCommand({
      store: ctx.promises,
      userId,
      groupId,
      text: rawText,
    });
    if (promiseCmd.handled) {
      await deliverNotice(ctx.client, {
        userId,
        groupId,
        text: promiseCmd.reply,
        chunkLimit: ctx.cfg.bridge.textChunkLimit,
      });
      return;
    }
  }

  if (skills.tasteMap !== false && ctx.tasteMap) {
    const tasteCmd = handleTasteMapCommand({
      store: ctx.tasteMap,
      sea: ctx.sea,
      userId,
      text: rawText,
    });
    if (tasteCmd.handled) {
      await deliverNotice(ctx.client, {
        userId,
        groupId,
        text: tasteCmd.reply,
        chunkLimit: ctx.cfg.bridge.textChunkLimit,
      });
      return;
    }
  }

  if (skills.knowledge !== false && ctx.knowledge) {
    const kbCmd = await handleKnowledgeAdmin({
      cfg: ctx.cfg,
      userId,
      text: rawText,
      kb: ctx.knowledge,
    });
    if (kbCmd.handled) {
      await deliverNotice(ctx.client, {
        userId,
        groupId,
        text: kbCmd.reply,
        chunkLimit: ctx.cfg.bridge.textChunkLimit,
      });
      return;
    }
  }

  if (ctx.autonomyPolicy) {
    const autoCmd = handleAutonomyAdmin({
      cfg: ctx.cfg,
      userId,
      groupId,
      text: rawText,
      policy: ctx.autonomyPolicy,
    });
    if (autoCmd.handled) {
      await deliverNotice(ctx.client, {
        userId,
        groupId,
        text: autoCmd.reply,
        chunkLimit: ctx.cfg.bridge.textChunkLimit,
      });
      return;
    }
  }

  if (skills.recallSlice !== false && isRecallSliceCommand(rawText)) {
    const recall = await handleRecallSlice({
      cfg: ctx.cfg,
      sea: ctx.sea,
      dsh: ctx.dsh,
      sessions: ctx.sessions,
      systemPrompt: activeSystemPrompt(ctx),
      userId,
      groupId,
      text: rawText,
    });
    if (recall.handled) {
      await deliverNotice(ctx.client, {
        userId,
        groupId,
        text: recall.reply,
        chunkLimit: ctx.cfg.bridge.textChunkLimit,
      });
      return;
    }
  }

  if (skills.eye !== false && ctx.eyeVault) {
    const vaultCmd = await handleEyeVaultAdmin({
      cfg: ctx.cfg,
      userId,
      groupId,
      text: rawText,
      client: ctx.client,
      vault: ctx.eyeVault,
      chunkLimit: ctx.cfg.bridge.textChunkLimit,
    });
    if (vaultCmd.handled) {
      if (vaultCmd.reply) {
        await deliverNotice(ctx.client, {
          userId,
          groupId,
          text: vaultCmd.reply,
          chunkLimit: ctx.cfg.bridge.textChunkLimit,
        });
      }
      return;
    }
  }

  if (skills.eye !== false) {
    const eyeCmd = await handleEyeLook({
      cfg: ctx.cfg,
      userId,
      groupId,
      text: rawText,
      dsh: ctx.dsh,
      sessions: ctx.sessions,
      systemPrompt: activeSystemPrompt(ctx),
      sea: ctx.sea,
      vault: ctx.eyeVault,
    });
    if (eyeCmd.handled) {
      await deliverNotice(ctx.client, {
        userId,
        groupId,
        text: eyeCmd.reply,
        chunkLimit: ctx.cfg.bridge.textChunkLimit,
      });
      return;
    }
  }

  // 群悄悄话：正文进模型，回复只走私聊。
  let chatText = rawText;
  let whisperPrivate = false;
  if (skills.whisper !== false && groupId) {
    const whisper = parseWhisper(rawText);
    if (whisper.ok) {
      whisperPrivate = true;
      chatText = whisper.body;
      await deliverNotice(ctx.client, {
        userId,
        groupId,
        text: whisperGroupAck(),
        chunkLimit: ctx.cfg.bridge.textChunkLimit,
      });
    }
  }

  const triggerIncoming = { ...incoming, rawText: chatText || incoming.rawText };
  // Whisper always continues. Otherwise need @/名字，或带图（避免「只发图+没@」被第二道判断静默丢掉）。
  if (
    !whisperPrivate &&
    !shouldTrigger(ctx.cfg, triggerIncoming) &&
    !images.length
  ) {
    return;
  }

  // 「说一句xxx」：直接念，不走 DSH（切配音后立刻试听用）。
  const directLine = parseDirectSpeakLine(chatText);
  if (directLine && ctx.cfg.social.tts?.enabled) {
    console.log(`[bridge] direct-speak user=${userId} line=${directLine.slice(0, 40)}`);
    await deliverReply(ctx.client, {
      userId,
      groupId: whisperPrivate ? undefined : groupId,
      text: directLine,
      chunkLimit: ctx.cfg.bridge.textChunkLimit,
      preferVoice: true,
      ...deliverExtras(ctx),
    });
    return;
  }

  console.log(
    `[bridge] chat user=${userId} group=${groupId || "-"} whisper=${whisperPrivate} text=${(chatText || "[图片]").slice(0, 60)}`,
  );

  if (ctx.cfg.social.personaCardsEnabled && ctx.personaCards) {
    ctx.personaCards.learnFromUtterance(
      userId,
      chatText,
      event.sender?.nickname ? String(event.sender.nickname) : undefined,
    );
  }

  if (skills.tasteMap !== false && ctx.tasteMap && chatText) {
    ctx.tasteMap.learnFromUtterance(userId, chatText);
  }

  void ctx.sea.ingestUtterance(
    groupId && !whisperPrivate
      ? { kind: "relation", userId, groupId }
      : { kind: "user", userId },
    chatText || "[图片]",
    {
      ownerId: userId,
      groupId: groupId && !whisperPrivate ? groupId : undefined,
      visibility: groupId && !whisperPrivate ? "group" : "private",
    },
  );

  const { block, evidenceIds } = buildMemoryPrefix(ctx.sea, ctx.cfg, {
    userId,
    groupId: whisperPrivate ? undefined : groupId,
    query: chatText || "图片",
  });

  const extras: string[] = [];
  if (whisperPrivate) {
    extras.push("【情境】用户在群里用悄悄话找你；请只当私聊回答，不要提群里其他人，不要暗示你在群里回话。");
  }
  if (ctx.cfg.social.personaCardsEnabled && ctx.personaCards) {
    const card = ctx.personaCards.formatForInject(userId);
    if (card) extras.push(card);
  }
  if (skills.tasteMap !== false && ctx.tasteMap) {
    const taste = ctx.tasteMap.formatForInject(userId);
    if (taste) extras.push(taste);
  }
  if (
    skills.knowledge !== false &&
    ctx.knowledge &&
    ctx.cfg.social.knowledge?.enabled !== false &&
    chatText
  ) {
    const kbBlock = ctx.knowledge.formatForInject(chatText);
    if (kbBlock) extras.push(kbBlock);
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

  if (groupId && !whisperPrivate && ctx.groupRecent) {
    const others = ctx.groupRecent.formatContext(groupId, userId);
    if (others) extras.push(others);
  }

  const deliverGroupId = whisperPrivate ? undefined : groupId;
  const memoryBlock = [block, ...extras].filter(Boolean).join("\n\n");
  const systemPrompt = activeSystemPrompt(ctx);
  const payload = composePromptWithPersona(
    systemPrompt,
    memoryBlock,
    chatText || (visionParts.length ? "（发了图片，请直接看图）" : "（发了一张图片）"),
    { userId, nickname, groupId: deliverGroupId },
  );
  const qqKey = qqSessionKey({ userId, groupId: deliverGroupId });
  const title = deliverGroupId ? `群 ${deliverGroupId} · ${nickname}` : `私聊 ${nickname}`;

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
        groupId: deliverGroupId,
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
    groupId: deliverGroupId,
    text: result.text || "……",
    chunkLimit: ctx.cfg.bridge.textChunkLimit,
    atSender: Boolean(deliverGroupId && incoming.isAtSelf),
    preferVoice: userAskedForVoice(chatText),
    ...deliverExtras(ctx),
  });

  mapping.updatedAt = new Date().toISOString();
  ctx.sessions.set(mapping);
}

function deliverExtras(ctx: IngressContext): {
  stickerDir?: string;
  stickers?: StickerEntry[];
  social?: AppConfig["social"];
  voiceRef?: { current: { edge: string; rate: string; pitch: string } };
} {
  if (!ctx.cfg.social.enabled) {
    return { social: ctx.cfg.social, voiceRef: ctx.voiceRef };
  }
  const stickerDir = path.isAbsolute(ctx.cfg.social.stickerDir)
    ? ctx.cfg.social.stickerDir
    : path.join(ctx.root, ctx.cfg.social.stickerDir);
  return {
    stickerDir,
    stickers: ctx.stickersRef.current,
    social: ctx.cfg.social,
    voiceRef: ctx.voiceRef,
  };
}
