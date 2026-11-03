import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OneBotClient, OneBotEvent } from "./client.js";

const MAX_IMAGE_BYTES = 3.2 * 1024 * 1024;
const MAX_IMAGES = 3;

export interface IncomingImage {
  url?: string;
  file?: string;
  localPath?: string;
  buffer?: Buffer;
  mimeType?: string;
}

export interface VisionImagePart {
  mediaType: string;
  data: string;
  name: string;
}

/** Extract image segments from a OneBot message event. */
export function extractImages(event: OneBotEvent): IncomingImage[] {
  const out: IncomingImage[] = [];
  if (Array.isArray(event.message)) {
    for (const seg of event.message) {
      if (!seg || typeof seg !== "object") continue;
      const s = seg as { type?: string; data?: Record<string, unknown> };
      if (s.type !== "image" && s.type !== "mface") continue;
      out.push({
        url: typeof s.data?.url === "string" ? s.data.url : undefined,
        file: typeof s.data?.file === "string" ? s.data.file : undefined,
      });
    }
  }
  if (typeof event.raw_message === "string") {
    const re = /\[CQ:image,([^\]]+)\]/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(event.raw_message))) {
      const body = m[1]!;
      const urlMatch = body.match(/(?:^|,)url=([^,\]]+)/i);
      const fileMatch = body.match(/(?:^|,)file=([^,\]]+)/i);
      const url = urlMatch?.[1] ? decodeURIComponent(urlMatch[1]) : undefined;
      const file = fileMatch?.[1] ? decodeURIComponent(fileMatch[1]) : undefined;
      if (!url && !file) continue;
      if (url && out.some((i) => i.url === url)) continue;
      out.push({ url, file });
    }
  }
  return out;
}

function sniffMime(buf: Buffer, hint?: string): string {
  if (hint && /^image\//i.test(hint)) return hint.split(";")[0]!.trim();
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (buf.length >= 6 && buf.toString("ascii", 0, 3) === "GIF") return "image/gif";
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return "image/jpeg";
}

async function fetchUrlBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
    const mime = sniffMime(buf, res.headers.get("content-type") || undefined);
    return { buffer: buf, mimeType: mime };
  } catch {
    return null;
  }
}

/** Download / resolve images into memory for DSH vision parts. */
export async function prepareVisionImages(
  images: IncomingImage[],
  opts: {
    cacheDir: string;
    client?: OneBotClient;
    limit?: number;
  },
): Promise<{ parts: VisionImagePart[]; saved: IncomingImage[] }> {
  if (!images.length) return { parts: [], saved: [] };
  mkdirSync(opts.cacheDir, { recursive: true });
  const limit = opts.limit ?? MAX_IMAGES;
  const parts: VisionImagePart[] = [];
  const saved: IncomingImage[] = [];

  for (const img of images.slice(0, limit)) {
    let buffer = img.buffer;
    let mimeType = img.mimeType;
    let localPath = img.localPath;

    if (!buffer && img.url && /^https?:\/\//i.test(img.url)) {
      const fetched = await fetchUrlBuffer(img.url);
      if (fetched) {
        buffer = fetched.buffer;
        mimeType = fetched.mimeType;
      }
    }

    if (!buffer && img.file && opts.client) {
      try {
        const data = (await opts.client.call("get_image", { file: img.file })) as {
          file?: string;
          url?: string;
          base64?: string;
        };
        if (data?.base64) {
          buffer = Buffer.from(String(data.base64).replace(/^base64:\/\//, ""), "base64");
        } else if (data?.url && /^https?:\/\//i.test(data.url)) {
          const fetched = await fetchUrlBuffer(data.url);
          if (fetched) {
            buffer = fetched.buffer;
            mimeType = fetched.mimeType;
          }
        } else if (data?.file && existsSync(data.file)) {
          buffer = readFileSync(data.file);
          localPath = data.file;
        }
      } catch {
        /* fall through */
      }
    }

    if (!buffer || buffer.length > MAX_IMAGE_BYTES) {
      saved.push(img);
      continue;
    }

    mimeType = sniffMime(buffer, mimeType);
    const ext = mimeType.split("/")[1] || "jpg";
    const name =
      (img.file && sanitizeName(img.file)) ||
      `img-${Date.now()}-${saved.length}.${ext}`;
    localPath = path.join(opts.cacheDir, name);
    try {
      writeFileSync(localPath, buffer);
    } catch {
      /* ignore cache write */
    }

    const row: IncomingImage = { ...img, buffer, mimeType, localPath };
    saved.push(row);
    parts.push({
      mediaType: mimeType,
      data: buffer.toString("base64"),
      name: `qq-image-${parts.length + 1}.${ext}`,
    });
  }

  return { parts, saved };
}

/** Kept for sticker-collect path. */
export async function downloadImages(
  images: IncomingImage[],
  cacheDir: string,
  limit = 3,
): Promise<IncomingImage[]> {
  const { saved } = await prepareVisionImages(images, { cacheDir, limit });
  return saved;
}

export function formatImageHint(saved: IncomingImage[], visionAttached: boolean): string {
  if (!saved.length && !visionAttached) return "";
  if (visionAttached) {
    return (
      `【已附带 ${Math.max(saved.length, 1)} 张图片给视觉模型，请直接看图内容回复】\n` +
      `不要说「看不清 / 没看清画面」；只有真的完全没有附带图片时才可以追问。`
    );
  }
  return `【用户发了图片但抓取失败】\n诚实说没拿到图，让对方重发；不要编造画面。`;
}

function sanitizeName(name: string): string {
  return name.replace(/[^\w.\u4e00-\u9fff-]+/g, "_").slice(0, 80);
}
