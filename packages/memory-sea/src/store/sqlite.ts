import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { MemoryStatus } from "@dsh-memory-sea/shared";
import type { StoredMemory } from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  importance REAL NOT NULL,
  confidence REAL NOT NULL,
  recall_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_recalled_at TEXT,
  active_days_anchor TEXT NOT NULL,
  consolidated_into TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  pin INTEGER NOT NULL DEFAULT 0,
  fact_key TEXT,
  owner_id TEXT,
  group_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_scope_status
  ON memories(scope_key, status);

CREATE INDEX IF NOT EXISTS idx_memories_updated
  ON memories(updated_at);

CREATE INDEX IF NOT EXISTS idx_memories_visibility
  ON memories(visibility, status);
`;

const EXTRA_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: "visibility", ddl: `ALTER TABLE memories ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'` },
  { name: "pin", ddl: `ALTER TABLE memories ADD COLUMN pin INTEGER NOT NULL DEFAULT 0` },
  { name: "fact_key", ddl: `ALTER TABLE memories ADD COLUMN fact_key TEXT` },
  { name: "owner_id", ddl: `ALTER TABLE memories ADD COLUMN owner_id TEXT` },
  { name: "group_id", ddl: `ALTER TABLE memories ADD COLUMN group_id TEXT` },
];

export class SqliteMemoryStore {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA);
    this.migrate();
  }

  private migrate(): void {
    const cols = this.db
      .prepare(`PRAGMA table_info(memories)`)
      .all() as unknown as Array<{ name: string }>;
    const have = new Set(cols.map((c) => c.name));
    for (const col of EXTRA_COLUMNS) {
      if (!have.has(col.name)) this.db.exec(col.ddl);
    }
  }

  close(): void {
    this.db.close();
  }

  insert(row: StoredMemory): void {
    this.db
      .prepare(
        `INSERT INTO memories (
          id, scope_key, content, category, importance, confidence,
          recall_count, status, tags_json, created_at, updated_at,
          last_recalled_at, active_days_anchor, consolidated_into,
          visibility, pin, fact_key, owner_id, group_id
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?
        )`,
      )
      .run(
        row.id,
        row.scope_key,
        row.content,
        row.category,
        row.importance,
        row.confidence,
        row.recall_count,
        row.status,
        row.tags_json,
        row.created_at,
        row.updated_at,
        row.last_recalled_at,
        row.active_days_anchor,
        row.consolidated_into,
        row.visibility,
        row.pin,
        row.fact_key,
        row.owner_id,
        row.group_id,
      );
  }

  update(row: StoredMemory): void {
    this.db
      .prepare(
        `UPDATE memories SET
          content = ?, category = ?, importance = ?, confidence = ?,
          recall_count = ?, status = ?, tags_json = ?, updated_at = ?,
          last_recalled_at = ?, active_days_anchor = ?, consolidated_into = ?,
          visibility = ?, pin = ?, fact_key = ?, owner_id = ?, group_id = ?
         WHERE id = ?`,
      )
      .run(
        row.content,
        row.category,
        row.importance,
        row.confidence,
        row.recall_count,
        row.status,
        row.tags_json,
        row.updated_at,
        row.last_recalled_at,
        row.active_days_anchor,
        row.consolidated_into,
        row.visibility,
        row.pin,
        row.fact_key,
        row.owner_id,
        row.group_id,
        row.id,
      );
  }

  getById(id: string): StoredMemory | undefined {
    return normalizeRow(
      this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as
        | Record<string, unknown>
        | undefined,
    );
  }

  listByScopes(scopeKeys: string[], statuses: MemoryStatus[]): StoredMemory[] {
    if (scopeKeys.length === 0) return [];
    const scopePlaceholders = scopeKeys.map(() => "?").join(", ");
    const statusPlaceholders = statuses.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE scope_key IN (${scopePlaceholders})
           AND status IN (${statusPlaceholders})`,
      )
      .all(...scopeKeys, ...statuses) as unknown as Record<string, unknown>[];
    return rows.map((r) => normalizeRow(r)!);
  }

  listActive(): StoredMemory[] {
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE status = 'active'`)
      .all() as unknown as Record<string, unknown>[];
    return rows.map((r) => normalizeRow(r)!);
  }

  listPending(): StoredMemory[] {
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE status = 'pending' ORDER BY created_at DESC`)
      .all() as unknown as Record<string, unknown>[];
    return rows.map((r) => normalizeRow(r)!);
  }

  listGraph(limit = 80): StoredMemory[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE status = 'active'
         ORDER BY pin DESC, importance DESC, updated_at DESC
         LIMIT ?`,
      )
      .all(limit) as unknown as Record<string, unknown>[];
    return rows.map((r) => normalizeRow(r)!);
  }

  findNearDuplicate(scopeKey: string, content: string): StoredMemory | undefined {
    const normalized = normalizeContent(content);
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE scope_key = ? AND status IN ('active', 'pending')`,
      )
      .all(scopeKey) as unknown as Record<string, unknown>[];
    return rows
      .map((r) => normalizeRow(r)!)
      .find((row) => normalizeContent(row.content) === normalized);
  }

  findActiveByFactKey(scopeKey: string, factKey: string): StoredMemory[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE scope_key = ? AND fact_key = ? AND status = 'active'`,
      )
      .all(scopeKey, factKey) as unknown as Record<string, unknown>[];
    return rows.map((r) => normalizeRow(r)!);
  }
}

function normalizeRow(row: Record<string, unknown> | undefined): StoredMemory | undefined {
  if (!row) return undefined;
  return {
    id: String(row.id),
    scope_key: String(row.scope_key),
    content: String(row.content),
    category: String(row.category) as StoredMemory["category"],
    importance: Number(row.importance),
    confidence: Number(row.confidence),
    recall_count: Number(row.recall_count ?? 0),
    status: String(row.status) as StoredMemory["status"],
    tags_json: String(row.tags_json ?? "[]"),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    last_recalled_at: row.last_recalled_at == null ? null : String(row.last_recalled_at),
    active_days_anchor: String(row.active_days_anchor),
    consolidated_into: row.consolidated_into == null ? null : String(row.consolidated_into),
    visibility: (row.visibility as StoredMemory["visibility"]) ?? "private",
    pin: Number(row.pin ?? 0) ? 1 : 0,
    fact_key: row.fact_key == null ? null : String(row.fact_key),
    owner_id: row.owner_id == null ? null : String(row.owner_id),
    group_id: row.group_id == null ? null : String(row.group_id),
  };
}

export function normalizeContent(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, " ");
}
