import type { OneBotClient } from "./client.js";

export function chunkText(text: string, limit: number): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];
  if (cleaned.length <= limit) return [cleaned];

  const chunks: string[] = [];
  let rest = cleaned;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.4) cut = rest.lastIndexOf("。", limit);
    if (cut < limit * 0.4) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit * 0.4) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export async function sendPlain(
  client: OneBotClient,
  opts: {
    userId?: string;
    groupId?: string;
    text: string;
    chunkLimit: number;
    replyToMessageId?: string | number;
    /** Group only: @ this QQ on the first bubble (when they @'d the bot). */
    atUserId?: string;
  },
): Promise<void> {
  const parts = chunkText(opts.text, opts.chunkLimit);
  const atUserId =
    opts.groupId && opts.atUserId && /^\d+$/.test(opts.atUserId)
      ? opts.atUserId
      : undefined;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const segs: Array<Record<string, unknown>> = [];
    if (i === 0 && opts.replyToMessageId != null && String(opts.replyToMessageId) !== "") {
      segs.push({ type: "reply", data: { id: String(opts.replyToMessageId) } });
    }
    if (i === 0 && atUserId) {
      segs.push({ type: "at", data: { qq: atUserId } });
      segs.push({ type: "text", data: { text: ` ${part}` } });
    } else if (segs.length) {
      segs.push({ type: "text", data: { text: part } });
    }

    await sendMessage(client, {
      userId: opts.userId,
      groupId: opts.groupId,
      message: segs.length ? segs : part,
    });
  }
}

/** Send a single image bubble (base64 payload, OneBot v11 style). */
export async function sendImage(
  client: OneBotClient,
  opts: {
    userId?: string;
    groupId?: string;
    base64: string;
  },
): Promise<void> {
  await sendMessage(client, {
    userId: opts.userId,
    groupId: opts.groupId,
    message: [{ type: "image", data: { file: `base64://${opts.base64}` } }],
  });
}

/** Send image by http(s) URL (custom face CDN, etc.). */
export async function sendImageUrl(
  client: OneBotClient,
  opts: {
    userId?: string;
    groupId?: string;
    url: string;
  },
): Promise<void> {
  await sendMessage(client, {
    userId: opts.userId,
    groupId: opts.groupId,
    message: [{ type: "image", data: { file: opts.url } }],
  });
}

/** QQ system face / yellow-face by numeric id. */
export async function sendFace(
  client: OneBotClient,
  opts: {
    userId?: string;
    groupId?: string;
    id: string | number;
  },
): Promise<void> {
  await sendMessage(client, {
    userId: opts.userId,
    groupId: opts.groupId,
    message: [{ type: "face", data: { id: String(opts.id) } }],
  });
}

export async function sendRecord(
  client: OneBotClient,
  opts: {
    userId?: string;
    groupId?: string;
    base64: string;
  },
): Promise<void> {
  await sendMessage(client, {
    userId: opts.userId,
    groupId: opts.groupId,
    message: [{ type: "record", data: { file: `base64://${opts.base64}` } }],
  });
}

async function sendMessage(
  client: OneBotClient,
  opts: {
    userId?: string;
    groupId?: string;
    message: unknown;
  },
): Promise<void> {
  if (opts.groupId) {
    await client.call("send_group_msg", {
      group_id: Number(opts.groupId),
      message: opts.message,
    });
    return;
  }
  if (opts.userId) {
    await client.call("send_private_msg", {
      user_id: Number(opts.userId),
      message: opts.message,
    });
  }
}

export function extractText(event: {
  raw_message?: string;
  message?: unknown;
}): string {
  if (typeof event.raw_message === "string" && event.raw_message.trim()) {
    return stripCq(event.raw_message);
  }
  if (typeof event.message === "string") return stripCq(event.message);
  if (Array.isArray(event.message)) {
    return event.message
      .map((seg) => {
        if (!seg || typeof seg !== "object") return "";
        const s = seg as { type?: string; data?: { text?: string } };
        if (s.type === "text") return s.data?.text ?? "";
        return "";
      })
      .join("");
  }
  return "";
}

export function isAtSelf(event: {
  raw_message?: string;
  message?: unknown;
  self_id?: number | string;
}): boolean {
  const selfId = String(event.self_id ?? "");
  if (typeof event.raw_message === "string" && selfId) {
    if (event.raw_message.includes(`[CQ:at,qq=${selfId}]`)) return true;
  }
  if (Array.isArray(event.message)) {
    return event.message.some((seg) => {
      if (!seg || typeof seg !== "object") return false;
      const s = seg as { type?: string; data?: { qq?: string } };
      return s.type === "at" && String(s.data?.qq) === selfId;
    });
  }
  return false;
}

function stripCq(text: string): string {
  return text.replace(/\[CQ:[^\]]+\]/g, " ").replace(/\s+/g, " ").trim();
}
