import type { AppConfig } from "@dsh-memory-sea/shared";
import { scopesForGroup, scopesForPrivate } from "@dsh-memory-sea/shared";
import type { MemorySea } from "@dsh-memory-sea/memory-sea";
import type { DshApiClient } from "../dsh/api-client.js";
import { qqSessionKey, type SessionStore } from "../dsh/sessions.js";

const RECALL_RE =
  /^(?:回看|\/回看|你还记得|记得吗)\s*(?:一下)?\s*(.+)$/s;

export function isRecallSliceCommand(text: string): boolean {
  return RECALL_RE.test(text.trim());
}

/**
 * Soft memory recall: pull a few crumbs, retell in persona voice (no transcript dump).
 */
export async function handleRecallSlice(opts: {
  cfg: AppConfig;
  sea: MemorySea;
  dsh: DshApiClient;
  sessions: SessionStore;
  systemPrompt: string;
  userId: string;
  groupId?: string;
  text: string;
}): Promise<{ handled: true; reply: string } | { handled: false }> {
  const text = opts.text.trim();
  const m = text.match(RECALL_RE);
  if (!m?.[1]?.trim()) return { handled: false };

  const query = m[1].trim().slice(0, 80);
  const scopes = opts.groupId
    ? scopesForGroup(opts.userId, opts.groupId)
    : scopesForPrivate(opts.userId);

  const evidence = opts.sea.recall(
    scopes,
    query,
    {
      limit: Math.min(4, opts.cfg.memory.recallLimit || 4),
      context: opts.groupId
        ? { channel: "group", groupId: opts.groupId, userId: opts.userId }
        : { channel: "private", userId: opts.userId },
    },
  );

  if (!evidence.length) {
    return {
      handled: true,
      reply: "翻了翻，没捞到和这个相关的碎片。也许当时没记进海里，或者忘得差不多了。",
    };
  }

  const crumbs = evidence
    .map((e, i) => `${i + 1}. (${e.category}) ${e.content.slice(0, 80)}`)
    .join("\n");

  try {
    // Dedicated recall session — keep「系统·回看」out of normal 私聊/群聊 history.
    const qqKey = qqSessionKey({
      userId: `recall-${opts.userId}`,
      groupId: undefined,
    });
    let mapping = opts.sessions.get(qqKey);
    if (!mapping) {
      const sessionId = await opts.dsh.ensureSession({
        key: qqKey,
        title: `回看切片 · ${opts.userId}`,
        systemPrompt: opts.systemPrompt,
      });
      mapping = {
        qqKey,
        sessionId,
        title: `回看 · ${opts.userId}`,
        updatedAt: new Date().toISOString(),
      };
      opts.sessions.set(mapping);
    }

    const message =
      `【系统·回看切片】用户想回想：「${query}」\n` +
      `下面是记忆海捞到的碎片（可能不全、可能不准）：\n${crumbs}\n\n` +
      `请用当前人设口吻，1～3 句轻声复述给你听的感觉；禁止逐字照抄、禁止说「根据记忆/系统/碎片」、` +
      `不要编造碎片里没有的细节；若几乎无关就说印象模糊。`;

    const result = await opts.dsh.prompt({
      sessionId: mapping.sessionId,
      message,
      systemPrompt: opts.systemPrompt,
    });
    opts.sea.reinforce(evidence.map((e) => e.id));
    mapping.updatedAt = new Date().toISOString();
    opts.sessions.set(mapping);

    const reply = (result.text || "").trim().slice(0, 300);
    return {
      handled: true,
      reply: reply || softFallback(crumbs, query),
    };
  } catch (err) {
    console.warn(
      "[bridge] recall-slice DSH failed, fallback:",
      err instanceof Error ? err.message : err,
    );
    return { handled: true, reply: softFallback(crumbs, query) };
  }
}

function softFallback(crumbs: string, query: string): string {
  return (
    `提到「${query}」，我这边零碎记得这些——不一定准：\n` +
    crumbs.replace(/^\d+\.\s*\([^)]+\)\s*/gm, "· ")
  );
}
