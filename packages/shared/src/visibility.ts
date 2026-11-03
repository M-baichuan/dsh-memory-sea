export type MemoryVisibility = "private" | "group" | "public";

/** Where a recall is happening. */
export type RecallChannel = "private" | "group";

export interface RecallContext {
  channel: RecallChannel;
  /** Required when channel === "group" for group-scoped visibility. */
  groupId?: string;
  /** Acting user; used for owner checks. */
  userId?: string;
}

/**
 * Mind-sea style occasion isolation:
 * - private: never surfaces in group chat
 * - group: only when recalling in that same group
 * - public: allowed in private and group
 */
export function isVisibleInChannel(
  visibility: MemoryVisibility,
  ctx: RecallContext,
  opts?: { memoryGroupId?: string | null },
): boolean {
  if (visibility === "public") return true;
  if (visibility === "private") return ctx.channel === "private";
  // visibility === "group"
  if (ctx.channel !== "group") return false;
  const mid = opts?.memoryGroupId ?? null;
  if (!mid) return true;
  return mid === ctx.groupId;
}
