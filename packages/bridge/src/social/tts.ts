import type { OneBotClient } from "../onebot/client.js";

export async function synthesizeVoiceBase64(
  text: string,
  httpUrl: string,
  opts?: { voice?: string; rate?: string; pitch?: string },
): Promise<string | null> {
  if (!httpUrl?.trim()) return null;
  try {
    const body: Record<string, string> = { text };
    if (opts?.voice?.trim()) body.voice = opts.voice.trim();
    if (opts?.rate?.trim()) body.rate = opts.rate.trim();
    if (opts?.pitch?.trim()) body.pitch = opts.pitch.trim();
    const res = await fetch(httpUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") || "";
    if (ctype.includes("application/json")) {
      const data = (await res.json()) as { base64?: string; audio?: string };
      return data.base64 || data.audio || null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch {
    return null;
  }
}

export async function sendVoice(
  client: OneBotClient,
  opts: { userId?: string; groupId?: string; base64: string },
): Promise<void> {
  const message = [{ type: "record", data: { file: `base64://${opts.base64}` } }];
  if (opts.groupId) {
    await client.call("send_group_msg", {
      group_id: Number(opts.groupId),
      message,
    });
    return;
  }
  if (opts.userId) {
    await client.call("send_private_msg", {
      user_id: Number(opts.userId),
      message,
    });
  }
}
