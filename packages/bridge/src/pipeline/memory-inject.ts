import { MemorySea } from "@dsh-memory-sea/memory-sea";
import {
  scopesForGroup,
  scopesForPrivate,
  type AppConfig,
  type RecallContext,
} from "@dsh-memory-sea/shared";

export interface SpeakerInfo {
  userId: string;
  nickname?: string;
  groupId?: string;
}

export function buildMemoryPrefix(
  sea: MemorySea,
  cfg: AppConfig,
  opts: { userId: string; groupId?: string; query: string },
): { block: string; evidenceIds: string[] } {
  const scopes = opts.groupId
    ? scopesForGroup(opts.userId, opts.groupId)
    : scopesForPrivate(opts.userId);

  const context: RecallContext = opts.groupId
    ? { channel: "group", groupId: opts.groupId, userId: opts.userId }
    : { channel: "private", userId: opts.userId };

  const evidence = sea.recall(scopes, opts.query, {
    limit: cfg.memory.recallLimit,
    context,
  });
  const block = sea.formatEvidenceBlock(evidence, cfg.memory.injectCharLimit);
  return { block, evidenceIds: evidence.map((e) => e.id) };
}

export function formatSpeakerLabel(speaker: SpeakerInfo): string {
  const name = speaker.nickname?.trim() || "未知昵称";
  if (speaker.groupId) {
    return `群友「${name}」(QQ:${speaker.userId})`;
  }
  return `私聊对象「${name}」(QQ:${speaker.userId})`;
}

export function composeUserPayload(
  memoryBlock: string,
  userText: string,
  speaker?: SpeakerInfo,
): string {
  const who = speaker ? formatSpeakerLabel(speaker) : "用户";
  const header = speaker?.groupId
    ? `[当前发言人] ${who}\n[只回复这个人；不要把上一条其他群友的话当成他/她说的]\n[消息]\n${userText}`
    : `[当前发言人] ${who}\n[消息]\n${userText}`;
  if (!memoryBlock) return header;
  return `${memoryBlock}\n\n${header}`;
}

/** Stick persona into the turn so Desktop sessions actually follow character. */
export function composePromptWithPersona(
  systemPrompt: string,
  memoryBlock: string,
  userText: string,
  speaker?: SpeakerInfo,
): string {
  const body = composeUserPayload(memoryBlock, userText, speaker);
  const persona = systemPrompt.trim();
  if (!persona) return body;
  return `【人设·勿复述】\n${persona}\n\n${body}`;
}
