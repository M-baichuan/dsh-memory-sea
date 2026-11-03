import type {
  MemoryCategory,
  MemoryStatus,
  MemoryVisibility,
} from "@dsh-memory-sea/shared";

export interface StoredMemory {
  id: string;
  scope_key: string;
  content: string;
  category: MemoryCategory;
  importance: number;
  confidence: number;
  recall_count: number;
  status: MemoryStatus;
  tags_json: string;
  created_at: string;
  updated_at: string;
  last_recalled_at: string | null;
  active_days_anchor: string;
  consolidated_into: string | null;
  visibility: MemoryVisibility;
  pin: number; // 0 | 1 for sqlite
  fact_key: string | null;
  owner_id: string | null;
  group_id: string | null;
}
