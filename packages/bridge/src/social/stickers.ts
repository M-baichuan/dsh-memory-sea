import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

const STICKER_TAG_RE = /\[\[(?:sticker|表情)\s*:\s*([^\]]+)\]\]/gi;
const VOICE_TAG_RE = /\[\[voice\s*:\s*([^\]]+)\]\]/gi;

export interface StickerEntry {
  id: string;
  filePath: string;
}

export interface ParsedReply {
  text: string;
  stickerIds: string[];
  voiceLines: string[];
}

export function listStickers(dir: string): StickerEntry[] {
  if (!existsSync(dir)) return [];
  const out: StickerEntry[] = [];
  for (const name of readdirSync(dir)) {
    const ext = path.extname(name).toLowerCase();
    if (!IMAGE_EXT.has(ext)) continue;
    const id = path.basename(name, ext);
    if (!id) continue;
    out.push({ id, filePath: path.join(dir, name) });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id, "zh"));
}

export function findSticker(entries: StickerEntry[], ref: string): StickerEntry | undefined {
  const key = String(ref ?? "").trim();
  if (!key) return undefined;
  const lower = key.toLowerCase();
  return (
    entries.find((e) => e.id === key) ??
    entries.find((e) => e.id.toLowerCase() === lower) ??
    entries.find((e) => e.id.includes(key) || key.includes(e.id))
  );
}

/** Strip sticker/voice tags from model text. */
export function parseStickerTags(raw: string): ParsedReply {
  const stickerIds: string[] = [];
  const voiceLines: string[] = [];
  const text = String(raw ?? "")
    .replace(VOICE_TAG_RE, (_m, line: string) => {
      const trimmed = String(line).trim();
      if (trimmed) voiceLines.push(trimmed);
      return "";
    })
    .replace(STICKER_TAG_RE, (_m, id: string) => {
      const trimmed = String(id).trim();
      if (trimmed) stickerIds.push(trimmed);
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, stickerIds, voiceLines };
}

export function readStickerBase64(entry: StickerEntry): string {
  return readFileSync(entry.filePath).toString("base64");
}

export function saveStickerFromBase64(
  dir: string,
  id: string,
  base64: string,
  ext = ".png",
): StickerEntry {
  const safe = id.replace(/[^\w\u4e00-\u9fff-]+/g, "_").slice(0, 40) || "sticker";
  const filePath = path.join(dir, `${safe}${ext.startsWith(".") ? ext : `.${ext}`}`);
  writeFileSync(filePath, Buffer.from(base64, "base64"));
  return { id: safe, filePath };
}

export function stickerHintForPrompt(
  entries: StickerEntry[],
  ttsEnabled: boolean,
  replyMode: "ask" | "tag" | "always" | "voice_only" = "ask",
): string {
  // ask：语音由 bridge 根据用户原话触发，勿写入人设提示（否则模型会主动提「语音」）。
  const voiceHint =
    !ttsEnabled || replyMode === "ask"
      ? ""
      : replyMode === "always" || replyMode === "voice_only"
        ? " 系统可能另发语音条；正文照常聊天，禁止提语音、禁止让对方发语音、禁止写 [[voice:]]。"
        : " 需要语音时用 [[voice:短句]]；禁止在正文里提语音或让对方发语音。";
  if (!entries.length) {
    const base = "无本地表情，勿写 sticker 标签。";
    return voiceHint ? `${base}${voiceHint}` : base;
  }
  const ids = entries.map((e) => e.id).join("/");
  return `表情：[[sticker:id]] id∈{${ids}}。多气泡用 |||。${voiceHint}`;
}
