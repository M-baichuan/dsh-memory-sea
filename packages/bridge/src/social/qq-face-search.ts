import type { OneBotClient } from "../onebot/client.js";
import { sendFace, sendImageUrl } from "../onebot/send.js";

export interface SysFaceHit {
  id: string;
  name: string;
  url?: string;
  source: "sys" | "custom" | "url";
}

/**
 * QQ client「搜索表情包」商城接口协议端基本没开放。
 * 能用的近似：SnowLuma search_sys_faces（系统黄脸）+ 收藏夹 URL。
 */
export async function searchQqExpression(
  client: OneBotClient,
  query: string,
): Promise<SysFaceHit | null> {
  const q = query.trim().slice(0, 24);
  if (!q) return null;

  const sys = await trySearchSysFaces(client, q);
  if (sys) return sys;

  const custom = await tryMatchCustomFace(client, q);
  if (custom) return custom;

  return null;
}

export async function sendQqExpression(
  client: OneBotClient,
  opts: {
    userId?: string;
    groupId?: string;
    hit: SysFaceHit;
  },
): Promise<void> {
  if (opts.hit.source === "sys" && /^\d+$/.test(opts.hit.id)) {
    await sendFace(client, {
      userId: opts.userId,
      groupId: opts.groupId,
      id: opts.hit.id,
    });
    return;
  }
  if (opts.hit.url) {
    await sendImageUrl(client, {
      userId: opts.userId,
      groupId: opts.groupId,
      url: opts.hit.url,
    });
    return;
  }
  throw new Error(`无法发送表情 hit=${opts.hit.id}`);
}

async function trySearchSysFaces(
  client: OneBotClient,
  query: string,
): Promise<SysFaceHit | null> {
  try {
    const data = (await client.call("search_sys_faces", { query })) as {
      faces?: Array<Record<string, unknown>>;
    };
    const faces = Array.isArray(data?.faces) ? data.faces : [];
    if (!faces.length) return null;
    const scored = faces
      .map((f) => ({ f, score: scoreFace(f, query) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0]?.f;
    if (!best || (scored[0]?.score ?? 0) <= 0) return null;
    const id = String(best.q_sid ?? best.em_code ?? best.id ?? "").trim();
    if (!id) return null;
    const name = String(
      best.q_des ?? best.name ?? (best.emoji_name_alias as string[] | undefined)?.[0] ?? query,
    );
    const url = typeof best.url === "string" ? best.url : undefined;
    return { id, name, url, source: "sys" };
  } catch (err) {
    console.warn(
      "[bridge] search_sys_faces unavailable:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function tryMatchCustomFace(
  client: OneBotClient,
  query: string,
): Promise<SysFaceHit | null> {
  try {
    const data = await client.call("fetch_custom_face", { count: 80 });
    const urls = normalizeCustomFaceList(data);
    if (!urls.length) return null;
    // Favorites often have no text metadata — pick first as weak fallback only
    // when query is very generic; otherwise require URL/path keyword hit.
    const q = query.toLowerCase();
    const keyed = urls.find((u) => u.toLowerCase().includes(q));
    if (keyed) {
      return { id: "custom", name: query, url: keyed, source: "custom" };
    }
    // No textual match in URLs — don't spam random favorites
    return null;
  } catch (err) {
    console.warn(
      "[bridge] fetch_custom_face unavailable:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function normalizeCustomFaceList(data: unknown): string[] {
  if (Array.isArray(data)) {
    return data
      .map((x) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object") {
          const o = x as Record<string, unknown>;
          return String(o.url ?? o.file ?? o.path ?? "");
        }
        return "";
      })
      .filter((u) => /^https?:\/\//i.test(u) || u.startsWith("base64://"));
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.list)) return normalizeCustomFaceList(o.list);
    if (Array.isArray(o.urls)) return normalizeCustomFaceList(o.urls);
  }
  return [];
}

function scoreFace(face: Record<string, unknown>, query: string): number {
  const q = query.toLowerCase();
  const name = String(face.q_des ?? face.name ?? "").toLowerCase();
  const aliases = Array.isArray(face.emoji_name_alias)
    ? face.emoji_name_alias.map((a) => String(a).toLowerCase())
    : [];
  const bag = [name, ...aliases, String(face.q_sid ?? "")];
  let score = 0;
  for (const s of bag) {
    if (!s) continue;
    if (s === q) score += 100;
    else if (s.includes(q) || q.includes(s)) score += 60;
    else {
      let hit = 0;
      for (const ch of q) if (s.includes(ch)) hit += 1;
      if (hit) score += hit * 5;
    }
  }
  return score;
}
