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
  const voiceHint = !ttsEnabled
    ? ""
    : replyMode === "always" || replyMode === "voice_only"
      ? " 回复会自动发语音，一般不必写 [[voice:]]。"
      : replyMode === "ask"
        ? " 用户说「用语音回复」时系统会另发语音，一般不必写 [[voice:]]。"
        : " 语音：[[voice:短句]]。";
  if (!entries.length) {
    return ttsEnabled
      ? `无本地表情。${voiceHint.trim()}`
      : "无本地表情，勿写 sticker 标签。";
  }
  const ids = entries.map((e) => e.id).join("/");
  return `表情：[[sticker:id]] id∈{${ids}}。多气泡用 |||。${voiceHint}`;
}
