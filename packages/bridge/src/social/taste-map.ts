import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MemorySea } from "@dsh-memory-sea/memory-sea";

export interface TasteCard {
  userId: string;
  likes: string[];
  dislikes: string[];
  updatedAt: string;
}

const LIST_RE = /^(?:口味地图|\/口味|看看口味)\s*$/;
const LIKE_RE = /^(?:我喜欢|口味\+|喜欢)\s+(.+)$/;
const DISLIKE_RE = /^(?:我不喜欢|我讨厌|口味-|讨厌|不吃)\s+(.+)$/;
const FORGET_RE = /^(?:忘掉口味|口味忘)\s+(.+)$/;

export function isTasteMapCommand(text: string): boolean {
  const t = text.trim();
  return LIST_RE.test(t) || LIKE_RE.test(t) || DISLIKE_RE.test(t) || FORGET_RE.test(t);
}

export class TasteMapStore {
  private map = new Map<string, TasteCard>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  get(userId: string): TasteCard | undefined {
    return this.map.get(userId);
  }

  formatForInject(userId: string): string {
    const card = this.map.get(userId);
    if (!card) return "";
    const bits: string[] = [];
    if (card.likes.length) bits.push(`偏向喜欢：${card.likes.slice(-6).join("、")}`);
    if (card.dislikes.length) bits.push(`不太喜欢：${card.dislikes.slice(-6).join("、")}`);
    if (!bits.length) return "";
    return `【口味地图——QQ:${userId}，轻偏好，勿写成人生档案】\n- ${bits.join("\n- ")}`;
  }

  formatStatus(userId: string): string {
    const card = this.map.get(userId);
    if (!card || (!card.likes.length && !card.dislikes.length)) {
      return (
        "口味地图还是空的。\n" +
        "可以说：我喜欢 火锅 / 我不喜欢 香菜\n" +
        "闲聊里提到「喜欢/讨厌…」我也会悄悄记一点。"
      );
    }
    const likes = card.likes.length ? `喜欢：${card.likes.join("、")}` : "喜欢：（无）";
    const dis = card.dislikes.length ? `不喜欢：${card.dislikes.join("、")}` : "不喜欢：（无）";
    return `口味地图\n${likes}\n${dis}\n忘掉：忘掉口味 火锅`;
  }

  addLike(userId: string, item: string): void {
    const card = this.ensure(userId);
    const v = cleanItem(item);
    if (!v) return;
    card.dislikes = card.dislikes.filter((x) => x !== v);
    if (!card.likes.includes(v)) card.likes.push(v);
    if (card.likes.length > 12) card.likes = card.likes.slice(-12);
    card.updatedAt = new Date().toISOString();
    this.map.set(userId, card);
    this.save();
  }

  addDislike(userId: string, item: string): void {
    const card = this.ensure(userId);
    const v = cleanItem(item);
    if (!v) return;
    card.likes = card.likes.filter((x) => x !== v);
    if (!card.dislikes.includes(v)) card.dislikes.push(v);
    if (card.dislikes.length > 12) card.dislikes = card.dislikes.slice(-12);
    card.updatedAt = new Date().toISOString();
    this.map.set(userId, card);
    this.save();
  }

  forget(userId: string, item: string): boolean {
    const card = this.map.get(userId);
    if (!card) return false;
    const v = cleanItem(item);
    const before = card.likes.length + card.dislikes.length;
    card.likes = card.likes.filter((x) => x !== v && !x.includes(v));
    card.dislikes = card.dislikes.filter((x) => x !== v && !x.includes(v));
    card.updatedAt = new Date().toISOString();
    this.map.set(userId, card);
    this.save();
    return card.likes.length + card.dislikes.length < before;
  }

  /** Heuristic from free chat (light). */
  learnFromUtterance(userId: string, text: string): void {
    const likeHit = text.match(
      /(?:我)?(?:很)?(?:喜欢|爱吃|爱看|爱听|想吃)\s*[「『]?([^，。！？\n「」『』]{1,16})/,
    );
    if (likeHit?.[1] && !/(你|她|他)/.test(likeHit[1])) {
      this.addLike(userId, likeHit[1]);
    }
    const hateHit = text.match(
      /(?:我)?(?:不喜欢|讨厌|不吃|不想吃)\s*[「『]?([^，。！？\n「」『』]{1,16})/,
    );
    if (hateHit?.[1] && !/(你|她|他)/.test(hateHit[1])) {
      this.addDislike(userId, hateHit[1]);
    }
  }

  private ensure(userId: string): TasteCard {
    return (
      this.map.get(userId) ?? {
        userId,
        likes: [],
        dislikes: [],
        updatedAt: new Date().toISOString(),
      }
    );
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as TasteCard[];
      for (const row of raw) {
        if (!row?.userId) continue;
        this.map.set(String(row.userId), {
          userId: String(row.userId),
          likes: Array.isArray(row.likes) ? row.likes.map(String) : [],
          dislikes: Array.isArray(row.dislikes) ? row.dislikes.map(String) : [],
          updatedAt: row.updatedAt || new Date().toISOString(),
        });
      }
    } catch {
      /* ignore */
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(
      this.filePath,
      JSON.stringify([...this.map.values()], null, 2),
      "utf8",
    );
  }
}

export function handleTasteMapCommand(opts: {
  store: TasteMapStore;
  sea?: MemorySea;
  userId: string;
  text: string;
}): { handled: true; reply: string } | { handled: false } {
  const text = opts.text.trim();
  if (!isTasteMapCommand(text)) return { handled: false };

  if (LIST_RE.test(text)) {
    return { handled: true, reply: opts.store.formatStatus(opts.userId) };
  }

  const like = text.match(LIKE_RE);
  if (like?.[1]) {
    opts.store.addLike(opts.userId, like[1]);
    rememberPreference(opts.sea, opts.userId, like[1].trim(), true);
    return { handled: true, reply: `记下了，你喜欢「${cleanItem(like[1])}」。` };
  }

  const dislike = text.match(DISLIKE_RE);
  if (dislike?.[1]) {
    opts.store.addDislike(opts.userId, dislike[1]);
    rememberPreference(opts.sea, opts.userId, dislike[1].trim(), false);
    return { handled: true, reply: `好，少提「${cleanItem(dislike[1])}」。` };
  }

  const forget = text.match(FORGET_RE);
  if (forget?.[1]) {
    const ok = opts.store.forget(opts.userId, forget[1]);
    return {
      handled: true,
      reply: ok ? `已从口味地图拿掉「${cleanItem(forget[1])}」。` : "口味地图里没找到这一项。",
    };
  }

  return { handled: false };
}

function cleanItem(raw: string): string {
  return String(raw ?? "")
    .replace(/[「」『』"'“”]/g, "")
    .trim()
    .slice(0, 16);
}

function rememberPreference(
  sea: MemorySea | undefined,
  userId: string,
  item: string,
  like: boolean,
): void {
  if (!sea) return;
  const v = cleanItem(item);
  if (!v) return;
  try {
    sea.remember(
      { kind: "user", userId },
      {
        content: like ? `对方喜欢：${v}` : `对方不太喜欢：${v}`,
        category: "preference",
        importance: 0.42,
        confidence: 0.85,
        tags: ["taste", like ? "like" : "dislike"],
        visibility: "private",
        ownerId: userId,
        factKey: `taste:${userId}:${like ? "like" : "dislike"}:${v}`,
      },
    );
  } catch {
    /* best-effort */
  }
}
