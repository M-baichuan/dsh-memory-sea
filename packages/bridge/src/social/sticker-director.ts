import type { OneBotClient } from "../onebot/client.js";
import { sendImage, sendPlain } from "../onebot/send.js";
import { findSticker, readStickerBase64, type StickerEntry } from "./stickers.js";

const DIR_RE = /^(?:配个表情|表情导演|\/表情)\s+(\S+)\s*$/;
const LIST_RE = /^(?:表情列表|\/表情列表)\s*$/;

export function isStickerDirectorCommand(text: string): boolean {
  const t = text.trim();
  return DIR_RE.test(t) || LIST_RE.test(t);
}

function scoreSticker(id: string, key: string): number {
  const a = id.toLowerCase();
  const b = key.toLowerCase();
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 80;
  let hit = 0;
  for (const ch of key) {
    if (id.includes(ch)) hit += 1;
  }
  return hit;
}

export function pickStickerByMood(
  entries: StickerEntry[],
  mood: string,
): StickerEntry | undefined {
  const key = mood.trim();
  if (!key || !entries.length) return undefined;
  const exact = findSticker(entries, key);
  if (exact) return exact;
  let best: StickerEntry | undefined;
  let bestScore = 0;
  for (const e of entries) {
    const s = scoreSticker(e.id, key);
    if (s > bestScore) {
      bestScore = s;
      best = e;
    }
  }
  return bestScore >= 1 ? best : undefined;
}

/**
 * 配个表情 无语 → send best matching local sticker (+ short line).
 */
export async function handleStickerDirector(opts: {
  client: OneBotClient;
  userId: string;
  groupId?: string;
  text: string;
  stickers: StickerEntry[];
  chunkLimit: number;
}): Promise<{ handled: true; reply?: string } | { handled: false }> {
  const text = opts.text.trim();
  if (!isStickerDirectorCommand(text)) return { handled: false };

  if (LIST_RE.test(text)) {
    if (!opts.stickers.length) {
      return { handled: true, reply: "本地还没有表情。带图发：收藏表情 开心" };
    }
    const ids = opts.stickers.map((s) => s.id).join("、");
    return {
      handled: true,
      reply: `手头这些表情：${ids}\n用法：配个表情 无语`,
    };
  }

  const m = text.match(DIR_RE);
  if (!m?.[1]) return { handled: false };
  const mood = m[1];
  const hit = pickStickerByMood(opts.stickers, mood);
  if (!hit) {
    return {
      handled: true,
      reply: `没配上「${mood}」。先看「表情列表」，或收藏一张：收藏表情 ${mood}`,
    };
  }

  try {
    await sendImage(opts.client, {
      userId: opts.userId,
      groupId: opts.groupId,
      base64: readStickerBase64(hit),
    });
    await sendPlain(opts.client, {
      userId: opts.userId,
      groupId: opts.groupId,
      text: `给你「${hit.id}」。`,
      chunkLimit: opts.chunkLimit,
    });
    return { handled: true };
  } catch (err) {
    return {
      handled: true,
      reply: `表情发出去失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
