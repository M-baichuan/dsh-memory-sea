import type { OneBotClient } from "./client.js";

export interface SendQzoneOpts {
  content: string;
  images?: string[];
  /** 1所有人 4好友 16部分好友 64仅自己 128部分不可见 */
  ugcRight?: number;
  targetUins?: Array<string | number>;
}

export interface SendQzoneResult {
  ok: boolean;
  tid?: string;
  time?: number;
  error?: string;
}

/**
 * NapCat 扩展：发表 QQ 空间说说。
 * 非 NapCat / 旧版本可能没有该 action。
 */
export async function sendQzoneMsg(
  client: OneBotClient,
  opts: SendQzoneOpts,
): Promise<SendQzoneResult> {
  const content = String(opts.content ?? "").trim();
  if (!content) return { ok: false, error: "内容为空" };

  try {
    const data = (await client.call("send_qzone_msg", {
      content,
      images: opts.images ?? [],
      ugc_right: opts.ugcRight ?? 4,
      target_uins: opts.targetUins ?? [],
    })) as { tid?: string; time?: number } | null;

    return {
      ok: true,
      tid: data?.tid != null ? String(data.tid) : undefined,
      time: typeof data?.time === "number" ? data.time : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
