import type { MemoryDraft } from "@dsh-memory-sea/shared";

const RULES: Array<{ re: RegExp; category: MemoryDraft["category"]; importance: number }> = [
  { re: /我叫\s*([^\s，。！？,.!?]+)/, category: "identity", importance: 0.95 },
  { re: /我是\s*([^\s，。！？,.!?]+)/, category: "identity", importance: 0.85 },
  { re: /我喜欢\s*([^，。！？,.!?]+)/, category: "fact", importance: 0.75 },
  { re: /我讨厌\s*([^，。！？,.!?]+)/, category: "fact", importance: 0.75 },
  { re: /我住在\s*([^，。！？,.!?]+)/, category: "fact", importance: 0.8 },
  { re: /我养了\s*([^，。！？,.!?]+)/, category: "fact", importance: 0.7 },
];

/**
 * Rule-based extractor. LLM batch extraction can be injected later via
 * optional callback without widening the public MemorySea interface.
 */
export function extractByRules(text: string): MemoryDraft[] {
  const drafts: MemoryDraft[] = [];
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (!m) continue;
    drafts.push({
      content: m[0]!.trim(),
      category: rule.category,
      importance: rule.importance,
      confidence: 0.8,
      tags: ["rule-extract"],
    });
  }
  return drafts;
}

export type LlmExtractor = (texts: string[]) => Promise<MemoryDraft[]>;
