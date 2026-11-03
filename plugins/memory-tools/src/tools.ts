import path from "node:path";
import { MemorySea } from "@dsh-memory-sea/memory-sea";
import {
  parseScopeKey,
  type MemoryDraft,
  type MemoryScope,
  type MemoryVisibility,
  type RecallChannel,
} from "@dsh-memory-sea/shared";

let singleton: MemorySea | null = null;

export function getSea(dbPath?: string): MemorySea {
  if (!singleton) {
    const resolved =
      dbPath ??
      process.env.MEMORY_SEA_DB ??
      path.resolve(process.cwd(), "data/memory/sea.sqlite");
    singleton = new MemorySea({ dbPath: resolved });
  }
  return singleton;
}

export function memoryRecall(args: {
  scopeKey: string;
  query: string;
  limit?: number;
  channel?: RecallChannel;
  groupId?: string;
  userId?: string;
}) {
  const sea = getSea();
  const scope = parseScopeKey(args.scopeKey);
  return sea.recall(scope, args.query, {
    limit: args.limit,
    context: args.channel
      ? {
          channel: args.channel,
          groupId: args.groupId,
          userId: args.userId,
        }
      : undefined,
  });
}

export function memorySave(args: {
  scopeKey: string;
  content: string;
  category?: MemoryDraft["category"];
  importance?: number;
  confidence?: number;
  visibility?: MemoryVisibility;
  pin?: boolean;
  factKey?: string;
}) {
  const sea = getSea();
  const scope = parseScopeKey(args.scopeKey) as MemoryScope;
  const id = sea.remember(scope, {
    content: args.content,
    category: args.category,
    importance: args.importance,
    confidence: args.confidence,
    visibility: args.visibility,
    pin: args.pin,
    factKey: args.factKey,
  });
  return { id };
}

export function memorySearch(args: {
  scopeKeys: string[];
  query: string;
  limit?: number;
  channel?: RecallChannel;
  groupId?: string;
  userId?: string;
}) {
  const sea = getSea();
  const scopes = args.scopeKeys.map(parseScopeKey);
  return sea.recall(scopes, args.query, {
    limit: args.limit ?? 8,
    context: args.channel
      ? {
          channel: args.channel,
          groupId: args.groupId,
          userId: args.userId,
        }
      : undefined,
  });
}

export function memoryPin(args: { id: string; pin?: boolean }) {
  const sea = getSea();
  sea.pin(args.id, args.pin !== false);
  return { ok: true, id: args.id, pin: args.pin !== false };
}

export const toolDefs = [
  {
    name: "memory_recall",
    description: "从记忆海按 scope 召回（艾宾浩斯 strength + 场合隔离）。",
    parameters: {
      type: "object",
      properties: {
        scopeKey: { type: "string", description: "user:ID / group:ID / relation:UID@GID" },
        query: { type: "string" },
        limit: { type: "number" },
        channel: { type: "string", enum: ["private", "group"] },
        groupId: { type: "string" },
        userId: { type: "string" },
      },
      required: ["scopeKey", "query"],
    },
  },
  {
    name: "memory_save",
    description: "写入长期记忆。visibility=private 的内容不会在群聊被召回。",
    parameters: {
      type: "object",
      properties: {
        scopeKey: { type: "string" },
        content: { type: "string" },
        category: { type: "string" },
        importance: { type: "number" },
        confidence: { type: "number" },
        visibility: { type: "string", enum: ["private", "group", "public"] },
        pin: { type: "boolean" },
        factKey: { type: "string" },
      },
      required: ["scopeKey", "content"],
    },
  },
  {
    name: "memory_search",
    description: "跨多个 scope 深挖记忆。",
    parameters: {
      type: "object",
      properties: {
        scopeKeys: { type: "array", items: { type: "string" } },
        query: { type: "string" },
        limit: { type: "number" },
        channel: { type: "string", enum: ["private", "group"] },
        groupId: { type: "string" },
        userId: { type: "string" },
      },
      required: ["scopeKeys", "query"],
    },
  },
  {
    name: "memory_pin",
    description: "钉住/取消钉住记忆；钉住的记忆不参与衰减剪枝。",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        pin: { type: "boolean" },
      },
      required: ["id"],
    },
  },
] as const;
