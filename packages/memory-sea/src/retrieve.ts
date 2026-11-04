import { daysBetween } from "./decay.js";

const STOPWORDS = new Set([
  "的",
  "了",
  "吗",
  "呢",
  "啊",
  "呀",
  "么",
  "什么",
  "怎么",
  "怎么样",
  "最近",
  "一下",
  "一个",
  "这个",
  "那个",
  "我们",
  "你们",
  "他们",
  "还有",
  "以及",
  "then",
  "the",
  "a",
  "an",
  "is",
  "are",
  "what",
  "how",
  "recently",
]);

export function keywordRelevance(query: string, content: string): number {
  const qRaw = query.trim().toLowerCase();
  const cRaw = content.trim().toLowerCase();
  if (!qRaw || !cRaw) return 0;

  if (cRaw.includes(qRaw) || qRaw.includes(cRaw)) return 1;

  const q = tokenize(qRaw).filter((t) => !STOPWORDS.has(t));
  const c = tokenize(cRaw);
  if (q.length === 0 || c.length === 0) return cjkCharOverlap(qRaw, cRaw);

  const contentSet = new Set(c);
  let hits = 0;
  for (const token of q) {
    if (contentSet.has(token)) hits += 1;
    else if (c.some((w) => w.includes(token) || token.includes(w))) hits += 0.5;
  }

  const coverage = hits / q.length;
  const charOverlap = cjkCharOverlap(qRaw, cRaw);
  return Math.min(1, Math.max(coverage, charOverlap));
}

/**
 * Hybrid score inspired by mind-sea weights, fused with our Ebbinghaus strength.
 * score = 0.45·relevance + 0.25·strength + 0.15·importance + 0.15·freshness
 */
export function hybridScore(input: {
  relevance: number;
  strength: number;
  importance: number;
  updatedAt: string;
  nowIso: string;
  pin?: boolean;
}): number {
  const freshness = freshnessScore(input.updatedAt, input.nowIso);
  const base =
    0.45 * clamp01(input.relevance) +
    0.25 * clamp01(input.strength) +
    0.15 * clamp01(input.importance) +
    0.15 * freshness;
  return input.pin ? Math.min(1, base + 0.08) : clamp01(base);
}

export function freshnessScore(updatedAt: string, nowIso: string, halfLifeDays = 14): number {
  const days = daysBetween(updatedAt, nowIso);
  return Math.exp((-Math.LN2 * days) / halfLifeDays);
}

function tokenize(text: string): string[] {
  const parts = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1);

  const tokens = new Set<string>(parts);
  for (const part of parts) {
    if ([...part].length >= 2 && /[\u4e00-\u9fff]/.test(part)) {
      const chars = [...part];
      for (let i = 0; i < chars.length - 1; i++) {
        tokens.add(chars[i]! + chars[i + 1]!);
      }
      for (const ch of chars) {
        if (/[\u4e00-\u9fff]/.test(ch)) tokens.add(ch);
      }
    }
  }
  return [...tokens];
}

function cjkCharOverlap(query: string, content: string): number {
  const qChars = [...query].filter((ch) => /[\u4e00-\u9fff\p{N}\p{L}]/u.test(ch));
  if (qChars.length === 0) return 0;
  let hit = 0;
  for (const ch of qChars) {
    if (content.includes(ch)) hit += 1;
  }
  return hit / qChars.length;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
