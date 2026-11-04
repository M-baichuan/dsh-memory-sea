import path from "node:path";
import type { AppConfig } from "@dsh-memory-sea/shared";
import type { OneBotClient, OneBotEvent } from "../onebot/client.js";
import { downloadImages, extractImages } from "../onebot/media.js";
import { extractText } from "../onebot/send.js";
import { listStickers, saveStickerFromBase64, type StickerEntry } from "./stickers.js";
import { readFileSync } from "node:fs";

const COLLECT_RE = /^(?:收藏表情|\/收藏)\s+(\S+)\s*$/;

export function tryParseCollectCommand(text: string): string | null {
  const m = text.trim().match(COLLECT_RE);
  return m?.[1]?.trim() || null;
}

/**
 * Admin: `收藏表情 开心` with an image in the same message → save to stickerDir.
 * Returns new entry or error message.
 */
export async function handleStickerCollect(opts: {
  cfg: AppConfig;
  root: string;
  client: OneBotClient;
  event: OneBotEvent;
  userId: string;
  stickersRef: { current: StickerEntry[] };
}): Promise<{ handled: true; reply: string } | { handled: false }> {
  if (!opts.cfg.social.stickerCollectEnabled) return { handled: false };
  const id = tryParseCollectCommand(extractText(opts.event));
  if (!id) return { handled: false };

  const isAdmin = opts.cfg.access.admins.includes(opts.userId);
  if (!isAdmin) {
    return { handled: true, reply: "只有管理员可以收藏表情。" };
  }

  const images = extractImages(opts.event);
  if (!images.length) {
    return { handled: true, reply: "请和图片一起发送：收藏表情 <id>" };
  }

  const stickerDir = path.isAbsolute(opts.cfg.social.stickerDir)
    ? opts.cfg.social.stickerDir
    : path.join(opts.root, opts.cfg.social.stickerDir);
  const cacheDir = path.join(opts.root, "data", "cache", "incoming");
  const downloaded = await downloadImages(images, cacheDir, 1);
  const first = downloaded[0];
  if (!first?.localPath && !first?.url) {
    return { handled: true, reply: "没能拿到图片，收藏失败。" };
  }

  try {
    let base64: string;
    let ext = ".png";
    if (first.localPath) {
      base64 = readFileSync(first.localPath).toString("base64");
      ext = path.extname(first.localPath) || ".png";
    } else {
      const res = await fetch(first.url!, { signal: AbortSignal.timeout(12_000) });
      const buf = Buffer.from(await res.arrayBuffer());
      base64 = buf.toString("base64");
      const ctype = res.headers.get("content-type") || "";
      if (ctype.includes("gif")) ext = ".gif";
      else if (ctype.includes("webp")) ext = ".webp";
      else if (ctype.includes("jpeg") || ctype.includes("jpg")) ext = ".jpg";
    }
    const entry = saveStickerFromBase64(stickerDir, id, base64, ext);
    opts.stickersRef.current = listStickers(stickerDir);
    return { handled: true, reply: `已收藏表情「${entry.id}」，可用 [[sticker:${entry.id}]]。` };
  } catch (err) {
    return {
      handled: true,
      reply: `收藏失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
