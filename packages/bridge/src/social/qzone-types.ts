export interface QzonePostType {
  id: string;
  aliases: string[];
  blurb: string;
  /** Extra instruction injected into the draft prompt. */
  promptHint: string;
}

/** Content styles for QQ Zone drafts (admin picks one). */
export const QZONE_POST_TYPES: QzonePostType[] = [
  {
    id: "心情",
    aliases: ["mood", "情绪"],
    blurb: "轻情绪、碎碎念",
    promptHint: "偏心情向：一两句当下感受，自然、不要矫情。",
  },
  {
    id: "日常",
    aliases: ["daily", "生活"],
    blurb: "生活小事、随手记",
    promptHint: "偏日常向：像随手发的小事或场景，口语、短。",
  },
  {
    id: "想念",
    aliases: ["miss", "想你"],
    blurb: "淡淡的想念（克制）",
    promptHint: "偏想念向：克制、含蓄，不要肉麻堆叠，1～2 句即可。",
  },
  {
    id: "吐槽",
    aliases: ["rant", "抱怨"],
    blurb: "轻吐槽、带点脾气",
    promptHint: "偏吐槽向：轻轻抱怨一件小事，有脾气但不阴阳怪气、不引战。",
  },
  {
    id: "晚安",
    aliases: ["goodnight", "夜晚"],
    blurb: "夜里收工/睡前",
    promptHint: "偏晚安向：夜里或睡前的短动态，温柔收束，不要鸡汤。",
  },
  {
    id: "早安",
    aliases: ["goodmorning", "早晨"],
    blurb: "早上醒来随口一句",
    promptHint: "偏早安向：早上随口一句，轻快或懒洋洋都行，短。",
  },
  {
    id: "随想",
    aliases: ["thought", "碎碎念", "随机"],
    blurb: "不定主题、随手一想",
    promptHint: "偏随想：不定主题，像脑子里忽然冒出的一句，生活感。",
  },
];

export function resolveQzonePostType(raw: string): QzonePostType | null {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return null;
  if (/^\d+$/.test(key)) {
    const idx = Number(key) - 1;
    return QZONE_POST_TYPES[idx] ?? null;
  }
  for (const t of QZONE_POST_TYPES) {
    if (t.id.toLowerCase() === key) return t;
    if (t.aliases.some((a) => a.toLowerCase() === key)) return t;
  }
  return null;
}

/** Parse leading type token from「发条动态 心情 下雨了」→ { type, rest }. */
export function splitTypeAndHint(raw: string): {
  type: QzonePostType | null;
  hint: string;
} {
  const text = String(raw ?? "").trim();
  if (!text) return { type: null, hint: "" };
  const parts = text.split(/\s+/);
  const first = parts[0] ?? "";
  const type = resolveQzonePostType(first);
  if (!type) return { type: null, hint: text };
  return { type, hint: parts.slice(1).join(" ").trim() };
}

export function formatQzoneTypesMenu(currentTypeId?: string): string {
  const lines = QZONE_POST_TYPES.map((t, i) => {
    const mark = currentTypeId && t.id === currentTypeId ? " ←" : "";
    return `${i + 1}. ${t.id} — ${t.blurb}${mark}`;
  });
  return (
    `可选动态类型：\n${lines.join("\n")}\n\n` +
    `用法：\n` +
    `· /动态类型 心情\n` +
    `· 选择发动态类型 2\n` +
    `· 发条动态 日常 下雨了想喝热饮`
  );
}
