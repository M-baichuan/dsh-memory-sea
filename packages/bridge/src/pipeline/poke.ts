import type { AppConfig } from "@dsh-memory-sea/shared";
import { evaluateAccess } from "../access/gate.js";
import type { OneBotClient } from "../onebot/client.js";
import { deliverReply } from "./egress.js";
import type { StickerEntry } from "../social/stickers.js";
import path from "node:path";

export interface PokeEventLike {
  post_type?: string;
  notice_type?: string;
  sub_type?: string;
  user_id?: number | string;
  group_id?: number | string;
  target_id?: number | string;
  self_id?: number | string;
}

export function isPokeAtSelf(event: PokeEventLike, selfId: string): boolean {
  if (event.post_type !== "notice") return false;
  const notice = String(event.notice_type || "");
  const sub = String(event.sub_type || "");
  const isPoke =
    (notice === "notify" && sub === "poke") ||
    notice === "poke" ||
    sub === "poke";
  if (!isPoke) return false;
  const target = String(event.target_id ?? "");
  if (selfId && target && target !== selfId) return false;
  return true;
}

export async function handlePoke(opts: {
  cfg: AppConfig;
  client: OneBotClient;
  event: PokeEventLike;
  root: string;
  stickers?: StickerEntry[];
}): Promise<boolean> {
  if (!opts.cfg.social.enabled || !opts.cfg.social.pokeEnabled) return false;
  const selfId = String(opts.event.self_id ?? opts.cfg.onebot.selfId ?? "");
  if (!isPokeAtSelf(opts.event, selfId)) return false;

  const userId = String(opts.event.user_id ?? "");
  if (!userId || (selfId && userId === selfId)) return false;
  const groupId = opts.event.group_id != null ? String(opts.event.group_id) : undefined;

  const access = evaluateAccess(opts.cfg, {
    userId,
    groupId,
    rawText: "poke",
    isAtSelf: true,
  });
  if (!access.allow) return true;

  const stickerDir = path.isAbsolute(opts.cfg.social.stickerDir)
    ? opts.cfg.social.stickerDir
    : path.join(opts.root, opts.cfg.social.stickerDir);

  await deliverReply(opts.client, {
    userId,
    groupId,
    text: opts.cfg.social.pokeReply,
    chunkLimit: opts.cfg.bridge.textChunkLimit,
    atSender: Boolean(groupId),
    stickerDir,
    stickers: opts.stickers,
    social: opts.cfg.social,
  });
  return true;
}
