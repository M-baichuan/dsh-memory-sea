export {
  type ScopeKind,
  type UserScope,
  type GroupScope,
  type RelationScope,
  type MemoryScope,
  scopeKey,
  parseScopeKey,
  scopesForPrivate,
  scopesForGroup,
} from "./scope.js";

export {
  AppConfigSchema,
  MemoryConfigSchema,
  CategoryConfigSchema,
  parseAppConfig,
  type AppConfig,
  type MemoryConfig,
  type CategoryConfig,
} from "./config-schema.js";

export {
  type MemoryVisibility,
  type RecallChannel,
  type RecallContext,
  isVisibleInChannel,
} from "./visibility.js";

import type { MemoryVisibility } from "./visibility.js";

export type MemoryCategory =
  | "identity"
  | "fact"
  | "event"
  | "assumption"
  | "chat_noise"
  | "preference"
  | "relation"
  | "skill"
  | "digest"
  | (string & {});

export type MemoryStatus = "active" | "pending" | "archived" | "pruned";

export interface MemoryDraft {
  content: string;
  category?: MemoryCategory;
  importance?: number;
  confidence?: number;
  tags?: string[];
  /** private | group | public — default inferred from scope */
  visibility?: MemoryVisibility;
  /** Pinned memories never decay / prune */
  pin?: boolean;
  /** Optional stable fact key for conflict detection */
  factKey?: string;
  /** Owning QQ user id when known */
  ownerId?: string;
  /** Group id when visibility/group-scoped */
  groupId?: string;
}

export interface MemoryRecord {
  id: string;
  scopeKey: string;
  content: string;
  category: MemoryCategory;
  importance: number;
  confidence: number;
  recallCount: number;
  status: MemoryStatus;
  tags: string[];
  visibility: MemoryVisibility;
  pin: boolean;
  factKey: string | null;
  ownerId: string | null;
  groupId: string | null;
  createdAt: string;
  updatedAt: string;
  lastRecalledAt: string | null;
  activeDaysAnchor: string;
}

export interface Evidence {
  id: string;
  content: string;
  category: MemoryCategory;
  scopeKey: string;
  strength: number;
  relevance: number;
  importance: number;
  freshness: number;
  score: number;
  visibility: MemoryVisibility;
  pin: boolean;
}

export type MemoryId = string;

export function defaultVisibilityForScope(
  scopeKind: "user" | "group" | "relation",
): MemoryVisibility {
  if (scopeKind === "user") return "private";
  if (scopeKind === "group") return "group";
  return "group";
}
