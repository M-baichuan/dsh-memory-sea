import type { StoredMemory } from "./store/types.js";
import { normalizeContent } from "./store/sqlite.js";

export interface ConsolidationPlan {
  keepId: string;
  archiveIds: string[];
  mergedContent: string;
  mergedImportance: number;
}

/**
 * Group near-duplicate active memories in the same scope and plan merges.
 * Keeps the highest-importance / most-recalled row and archives the rest.
 */
export function planConsolidations(rows: StoredMemory[]): ConsolidationPlan[] {
  const byScope = new Map<string, StoredMemory[]>();
  for (const row of rows) {
    if (row.status !== "active") continue;
    const list = byScope.get(row.scope_key) ?? [];
    list.push(row);
    byScope.set(row.scope_key, list);
  }

  const plans: ConsolidationPlan[] = [];
  for (const group of byScope.values()) {
    const clusters = clusterByOverlap(group);
    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      const ranked = [...cluster].sort(rankMemory);
      const keep = ranked[0]!;
      const archive = ranked.slice(1);
      plans.push({
        keepId: keep.id,
        archiveIds: archive.map((r) => r.id),
        mergedContent: mergeContents(ranked.map((r) => r.content)),
        mergedImportance: Math.max(...ranked.map((r) => r.importance)),
      });
    }
  }
  return plans;
}

function clusterByOverlap(rows: StoredMemory[]): StoredMemory[][] {
  const clusters: StoredMemory[][] = [];
  const used = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]!;
    if (used.has(a.id)) continue;
    const cluster = [a];
    used.add(a.id);
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j]!;
      if (used.has(b.id)) continue;
      if (similar(a.content, b.content)) {
        cluster.push(b);
        used.add(b.id);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function similar(a: string, b: string): boolean {
  const na = normalizeContent(a);
  const nb = normalizeContent(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  if (ta.size === 0 || tb.size === 0) return false;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return inter / union >= 0.7;
}

function rankMemory(a: StoredMemory, b: StoredMemory): number {
  if (b.importance !== a.importance) return b.importance - a.importance;
  if (b.recall_count !== a.recall_count) return b.recall_count - a.recall_count;
  return Date.parse(b.updated_at) - Date.parse(a.updated_at);
}

function mergeContents(contents: string[]): string {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const c of contents) {
    const n = normalizeContent(c);
    if (seen.has(n)) continue;
    seen.add(n);
    unique.push(c.trim());
  }
  if (unique.length === 1) return unique[0]!;
  return unique.join("；");
}
