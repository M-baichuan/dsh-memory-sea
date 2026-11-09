import type { MemoryDraft } from "@dsh-memory-sea/shared";

const SENSITIVE =
  /(密码|验证码|token|api[_\s-]?key|私钥|银行卡|身份证|\b\d{16,19}\b)/i;

export interface GateResult {
  ok: boolean;
  status: "active" | "pending";
  reason?: string;
  importance: number;
  confidence: number;
  category: string;
}

export function evaluateDraft(draft: MemoryDraft): GateResult {
  const content = draft.content?.trim() ?? "";
  if (content.length < 2) {
    return {
      ok: false,
      status: "pending",
      reason: "empty",
      importance: 0,
      confidence: 0,
      category: draft.category ?? "chat_noise",
    };
  }

  if (SENSITIVE.test(content)) {
    return {
      ok: false,
      status: "pending",
      reason: "sensitive",
      importance: draft.importance ?? 0.2,
      confidence: draft.confidence ?? 0.2,
      category: draft.category ?? "fact",
    };
  }

  const confidence = clamp01(draft.confidence ?? 0.7);
  const importance = clamp01(draft.importance ?? 0.6);
  const category = draft.category ?? inferCategory(content);

  if (confidence < 0.55) {
    return {
      ok: true,
      status: "pending",
      reason: "low_confidence",
      importance,
      confidence,
      category,
    };
  }

  return {
    ok: true,
    status: "active",
    importance,
    confidence,
    category,
  };
}

function inferCategory(content: string): string {
  if (/(我叫|我是|名字|昵称)/.test(content)) return "identity";
  if (/(喜欢|讨厌|习惯|住在|养了|工作)/.test(content)) return "fact";
  if (/(昨天|今天|明天|上周|约定|活动)/.test(content)) return "event";
  if (/(可能|大概|好像|或许)/.test(content)) return "assumption";
  return "fact";
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
