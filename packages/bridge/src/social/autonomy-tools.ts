import type { AppConfig } from "@dsh-memory-sea/shared";
import type { OneBotClient } from "../onebot/client.js";
import { sendImage, sendRecord } from "../onebot/send.js";
import { deliverReply } from "../pipeline/egress.js";
import type { AutonomyDecision } from "./autonomy-decide.js";
import { resolveOwnerQq } from "./eye.js";
import {
  parsePromiseDue,
  type PromiseStore,
} from "./promises.js";
import type { QzoneDraftStore } from "./qzone-draft.js";
import { resolveQzonePostType } from "./qzone-types.js";
import { pickStickerByMood } from "./sticker-director.js";
import {
  readStickerBase64,
  type StickerEntry,
} from "./stickers.js";
import { synthesizeVoiceBase64 } from "./tts.js";

export interface AutonomyToolFlags {
  sendText: boolean;
  sendSticker: boolean;
  sendVoice: boolean;
  scheduleNudge: boolean;
  draftQzone: boolean;
}

export function allowedToolNames(flags: AutonomyToolFlags): string[] {
  const names = ["noop"];
  if (flags.sendText) names.push("send_text");
  if (flags.sendSticker) names.push("send_sticker");
  if (flags.sendVoice) names.push("send_voice");
  if (flags.scheduleNudge) names.push("schedule_nudge");
  if (flags.draftQzone) names.push("draft_qzone");
  return names;
}

export function resolveToolFlags(cfg: AppConfig): AutonomyToolFlags {
  const t = cfg.social.autonomy?.tools;
  const ttsOn = Boolean(cfg.social.tts?.enabled && cfg.social.tts.httpUrl);
  return {
    sendText: t?.sendText !== false,
    sendSticker: t?.sendSticker !== false,
    sendVoice: t?.sendVoice === true && ttsOn,
    scheduleNudge: t?.scheduleNudge !== false,
    draftQzone: t?.draftQzone !== false && cfg.social.qzone?.enabled !== false,
  };
}

export interface AutonomyExecDeps {
  cfg: AppConfig;
  client: OneBotClient;
  stickers: StickerEntry[];
  promises?: PromiseStore;
  qzoneDrafts?: QzoneDraftStore;
  voiceRef?: { current: { edge: string; rate: string; pitch: string } };
  tools: AutonomyToolFlags;
}

export interface AutonomyExecResult {
  ok: boolean;
  summary: string;
}

export interface AutonomyTarget {
  groupId?: string;
  userId?: string;
}

/**
 * Execute one whitelist decision against group or private target (L2).
 * Never publishes QZone — only drafts + notifies admins.
 */
export async function executeAutonomyDecision(
  deps: AutonomyExecDeps,
  opts: { target: AutonomyTarget; decision: AutonomyDecision },
): Promise<AutonomyExecResult> {
  const { decision } = opts;
  const target = resolveSendTarget(deps.cfg, opts.target, decision);
  const selfId = deps.cfg.onebot.selfId || "0";
  const deliverUserId = target.groupId ? selfId : target.userId || selfId;
  const groupId = target.groupId;

  switch (decision.action) {
    case "noop":
      return { ok: true, summary: `noop${decision.reason ? ` (${decision.reason})` : ""}` };

    case "send_text": {
      if (!deps.tools.sendText) {
        return { ok: false, summary: "send_text 未启用" };
      }
      if (!target.groupId && !target.userId) {
        return { ok: false, summary: "send_text 无目标" };
      }
      const text = (decision.text || "").trim();
      if (!text) return { ok: false, summary: "send_text 无内容" };
      await deliverReply(deps.client, {
        userId: deliverUserId,
        groupId,
        text: text.slice(0, 400),
        chunkLimit: deps.cfg.bridge.textChunkLimit,
        stickers: deps.stickers,
        social: deps.cfg.social,
        voiceRef: deps.voiceRef,
      });
      return {
        ok: true,
        summary: `send_text ${groupId ? `g:${groupId}` : `u:${target.userId}`} ${text.slice(0, 40)}`,
      };
    }

    case "send_sticker": {
      if (!deps.tools.sendSticker) {
        return { ok: false, summary: "send_sticker 未启用" };
      }
      if (!target.groupId && !target.userId) {
        return { ok: false, summary: "send_sticker 无目标" };
      }
      const mood = (decision.sticker || decision.text || "").trim();
      if (!mood) return { ok: false, summary: "send_sticker 无关键词" };
      const hit = pickStickerByMood(deps.stickers, mood);
      if (!hit) return { ok: false, summary: `表情未命中「${mood}」` };
      await sendImage(deps.client, {
        userId: deliverUserId,
        groupId,
        base64: readStickerBase64(hit),
      });
      if (decision.text?.trim() && decision.text.trim() !== mood) {
        await deliverReply(deps.client, {
          userId: deliverUserId,
          groupId,
          text: decision.text.trim().slice(0, 120),
          chunkLimit: deps.cfg.bridge.textChunkLimit,
          stickers: deps.stickers,
          social: deps.cfg.social,
          voiceRef: deps.voiceRef,
        });
      }
      return { ok: true, summary: `send_sticker ${hit.id}` };
    }

    case "send_voice": {
      if (!deps.tools.sendVoice) {
        return { ok: false, summary: "send_voice 未启用" };
      }
      if (!target.groupId && !target.userId) {
        return { ok: false, summary: "send_voice 无目标" };
      }
      const tts = deps.cfg.social.tts;
      const line = (decision.text || "").trim().slice(0, 120);
      if (!line) return { ok: false, summary: "send_voice 无文案" };
      if (!tts?.enabled || !tts.httpUrl?.trim()) {
        return { ok: false, summary: "TTS 未开" };
      }
      const vs = deps.voiceRef?.current;
      const b64 = await synthesizeVoiceBase64(line, tts.httpUrl, {
        voice: vs?.edge || tts.voice,
        rate: vs?.rate,
        pitch: vs?.pitch,
      });
      if (!b64) return { ok: false, summary: "TTS 合成失败" };
      await sendRecord(deps.client, {
        userId: deliverUserId,
        groupId,
        base64: b64,
      });
      return { ok: true, summary: `send_voice ${line.slice(0, 40)}` };
    }

    case "schedule_nudge": {
      if (!deps.tools.scheduleNudge || !deps.promises) {
        return { ok: false, summary: "schedule_nudge 未启用" };
      }
      const userId =
        (decision.userId || "").trim() ||
        (!groupId ? target.userId : "") ||
        resolveOwnerQq(deps.cfg);
      if (!/^\d+$/.test(userId)) {
        return { ok: false, summary: "schedule_nudge 需要合法 userId" };
      }
      if (!isAllowedUser(deps.cfg, userId)) {
        return { ok: false, summary: "目标不在白名单" };
      }
      const hint = (decision.dueHint || decision.text || "").trim();
      if (!hint) return { ok: false, summary: "schedule_nudge 无内容" };
      const parsed = parsePromiseDue(hint);
      if (!parsed?.text) return { ok: false, summary: "无法解析约定时间" };
      const maxDue = Date.now() + 48 * 3600_000;
      const dueAt = Math.min(parsed.dueAt.getTime(), maxDue);
      deps.promises.add({
        userId,
        groupId,
        text: parsed.text.slice(0, 80),
        dueAt: new Date(dueAt).toISOString(),
      });
      return {
        ok: true,
        summary: `schedule_nudge →${userId} ${parsed.text.slice(0, 30)}`,
      };
    }

    case "draft_qzone": {
      if (!deps.tools.draftQzone || !deps.qzoneDrafts) {
        return { ok: false, summary: "draft_qzone 未启用" };
      }
      if (deps.cfg.social.qzone?.enabled === false) {
        return { ok: false, summary: "空间功能关闭" };
      }
      const admins = deps.cfg.access.admins.filter(Boolean);
      if (!admins.length) return { ok: false, summary: "无管理员可收草稿" };
      const type =
        resolveQzonePostType(decision.qzoneType || "随想") ||
        resolveQzonePostType("随想");
      const content = (decision.text || decision.qzoneHint || "").trim().slice(0, 200);
      if (!content) return { ok: false, summary: "draft_qzone 无文案" };
      const owner = admins[0]!;
      deps.qzoneDrafts.set({
        content,
        typeId: type?.id,
        hint: decision.qzoneHint,
        createdBy: owner,
        createdAt: new Date().toISOString(),
      });
      const notice =
        `我起了一条空间草稿（未发）【${type?.id || "随想"}】：\n${content}\n` +
        `确认发动态 / 取消动态 / 看看草稿`;
      for (const admin of admins.slice(0, 3)) {
        try {
          await deliverReply(deps.client, {
            userId: admin,
            text: notice,
            chunkLimit: deps.cfg.bridge.textChunkLimit,
            social: deps.cfg.social,
          });
        } catch (err) {
          console.warn(
            "[autonomy] draft notify failed",
            err instanceof Error ? err.message : err,
          );
        }
      }
      return { ok: true, summary: `draft_qzone ${type?.id || ""} ${content.slice(0, 30)}` };
    }

    default:
      return { ok: false, summary: `未知动作 ${String(decision.action)}` };
  }
}

/** Prefer loop-provided target; private channel forces owner when configured. */
export function resolveSendTarget(
  cfg: AppConfig,
  target: AutonomyTarget,
  decision: AutonomyDecision,
): AutonomyTarget {
  if (decision.channel === "private" || (!target.groupId && target.userId)) {
    const ownerOnly = cfg.social.autonomy?.privateOwnerOnly !== false;
    const userId = ownerOnly
      ? resolveOwnerQq(cfg)
      : decision.userId || target.userId || resolveOwnerQq(cfg);
    return { userId };
  }
  if (target.groupId) return { groupId: target.groupId };
  return target;
}

function isAllowedUser(cfg: AppConfig, userId: string): boolean {
  if (cfg.access.admins.includes(userId)) return true;
  if (userId === resolveOwnerQq(cfg)) return true;
  if (cfg.access.allowUsers.length === 0) return true;
  return cfg.access.allowUsers.includes(userId);
}
