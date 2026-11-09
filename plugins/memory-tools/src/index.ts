import {
  memoryPin,
  memoryRecall,
  memorySave,
  memorySearch,
  toolDefs,
} from "./tools.js";
import type { MemoryVisibility, RecallChannel } from "@dsh-memory-sea/shared";

export const name = "@dsh-memory-sea/memory-tools";

/** Cordis: accessing ctx.tools without inject throws "cannot get property without inject". */
export const inject = ["tools"];

export interface CordisLikeContext {
  tools?: {
    register?: (def: unknown, handler: (args: Record<string, unknown>) => unknown) => void;
  };
  logger?: { info: (msg: string) => void };
}

export function apply(ctx: CordisLikeContext) {
  ctx.logger?.info?.("[memory-tools] loaded");
  const register = ctx.tools?.register;
  if (!register) {
    ctx.logger?.info?.("[memory-tools] no ctx.tools.register; exporting handlers only");
    return;
  }

  register(toolDefs[0], (args) =>
    memoryRecall({
      scopeKey: String(args.scopeKey ?? ""),
      query: String(args.query ?? ""),
      limit: args.limit != null ? Number(args.limit) : undefined,
      channel: args.channel as RecallChannel | undefined,
      groupId: args.groupId != null ? String(args.groupId) : undefined,
      userId: args.userId != null ? String(args.userId) : undefined,
    }),
  );
  register(toolDefs[1], (args) =>
    memorySave({
      scopeKey: String(args.scopeKey ?? ""),
      content: String(args.content ?? ""),
      category: args.category != null ? String(args.category) : undefined,
      importance: args.importance != null ? Number(args.importance) : undefined,
      confidence: args.confidence != null ? Number(args.confidence) : undefined,
      visibility: args.visibility as MemoryVisibility | undefined,
      pin: args.pin != null ? Boolean(args.pin) : undefined,
      factKey: args.factKey != null ? String(args.factKey) : undefined,
    }),
  );
  register(toolDefs[2], (args) =>
    memorySearch({
      scopeKeys: Array.isArray(args.scopeKeys) ? args.scopeKeys.map(String) : [],
      query: String(args.query ?? ""),
      limit: args.limit != null ? Number(args.limit) : undefined,
      channel: args.channel as RecallChannel | undefined,
      groupId: args.groupId != null ? String(args.groupId) : undefined,
      userId: args.userId != null ? String(args.userId) : undefined,
    }),
  );
  register(toolDefs[3], (args) =>
    memoryPin({
      id: String(args.id ?? ""),
      pin: args.pin != null ? Boolean(args.pin) : true,
    }),
  );
}

export { memoryRecall, memorySave, memorySearch, memoryPin, toolDefs };
