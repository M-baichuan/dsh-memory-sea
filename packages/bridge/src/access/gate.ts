import type { AppConfig } from "@dsh-memory-sea/shared";

export interface IncomingMessage {
  userId: string;
  groupId?: string;
  rawText: string;
  isAtSelf: boolean;
}

export type GateDecision =
  | { allow: true; reason: "admin" | "allowlist" | "open" }
  | { allow: false; reason: "denied"; reply?: string };

export function evaluateAccess(cfg: AppConfig, msg: IncomingMessage): GateDecision {
  if (cfg.access.admins.includes(msg.userId)) {
    return { allow: true, reason: "admin" };
  }

  if (msg.groupId) {
    const groups = cfg.access.allowGroups;
    if (groups.length > 0 && !groups.includes(msg.groupId)) {
      return {
        allow: false,
        reason: "denied",
        reply: "本群尚未批准接入记忆海，请联系管理员。",
      };
    }
  } else {
    const users = cfg.access.allowUsers;
    if (users.length > 0 && !users.includes(msg.userId)) {
      return {
        allow: false,
        reason: "denied",
        reply: "私聊尚未批准，请联系管理员。",
      };
    }
  }

  return { allow: true, reason: usersOrGroupsOpen(cfg) ? "open" : "allowlist" };
}

export function shouldTrigger(cfg: AppConfig, msg: IncomingMessage): boolean {
  if (!msg.groupId) return true;
  if (!cfg.access.requireMention) return true;
  if (msg.isAtSelf) return true;
  const text = msg.rawText;
  return cfg.access.triggerNames.some((name) => name && text.includes(name));
}

function usersOrGroupsOpen(cfg: AppConfig): boolean {
  return cfg.access.allowUsers.length === 0 && cfg.access.allowGroups.length === 0;
}
