import { randomUUID } from "node:crypto";
import {
  type Evidence,
  type MemoryDraft,
  type MemoryId,
  type MemoryRecord,
  type MemoryScope,
  type MemoryConfig,
  type RecallContext,
  type MemoryVisibility,
  MemoryConfigSchema,
  defaultVisibilityForScope,
  isVisibleInChannel,
  scopeKey,
} from "@dsh-memory-sea/shared";
import { computeStrength, daysBetween, resolveCategoryConfig } from "./decay.js";
import { evaluateDraft } from "./quality-gate.js";
import { hybridScore, keywordRelevance } from "./retrieve.js";
import { planConsolidations } from "./consolidate.js";
import { extractByRules, type LlmExtractor } from "./extract.js";
import { SqliteMemoryStore } from "./store/sqlite.js";
import type { StoredMemory } from "./store/types.js";

export interface MemorySeaOptions {
  dbPath: string;
  config?: Partial<MemoryConfig>;
  now?: () => Date;
  llmExtractor?: LlmExtractor;
}

export interface RecallOptions {
  limit?: number;
  /** Occasion isolation context; omit to skip visibility filtering. */
  context?: RecallContext;
  minScore?: number;
}

export class MemorySea {
  private readonly store: SqliteMemoryStore;
  private readonly config: MemoryConfig;
  private readonly now: () => Date;
  private readonly llmExtractor?: LlmExtractor;

  constructor(options: MemorySeaOptions) {
    this.store = new SqliteMemoryStore(options.dbPath);
    this.config = MemoryConfigSchema.parse(options.config ?? {});
    this.now = options.now ?? (() => new Date());
    this.llmExtractor = options.llmExtractor;
  }

  close(): void {
    this.store.close();
  }

  recall(
    scopes: MemoryScope | MemoryScope[],
    query: string,
    limitOrOpts?: number | RecallOptions,
  ): Evidence[] {
    const opts: RecallOptions =
      typeof limitOrOpts === "number" ? { limit: limitOrOpts } : (limitOrOpts ?? {});
    const scopeList = Array.isArray(scopes) ? scopes : [scopes];
    const keys = scopeList.map(scopeKey);
    const top = opts.limit ?? this.config.recallLimit;
    const minScore = opts.minScore ?? 0.08;
    const rows = this.store.listByScopes(keys, ["active"]);
    const nowIso = this.now().toISOString();

    const scored: Evidence[] = [];
    for (const row of rows) {
      if (
        opts.context &&
        !isVisibleInChannel(row.visibility, opts.context, {
          memoryGroupId: row.group_id,
        })
      ) {
        continue;
      }

      const pinned = Boolean(row.pin);
      const cat = resolveCategoryConfig(this.config, row.category);
      const activeDays = daysBetween(row.active_days_anchor, nowIso);
      const strength = pinned
        ? 1
        : computeStrength({
            importance: row.importance,
            recallCount: row.recall_count,
            activeDays,
            baseLambda: cat.baseLambda,
          });
      if (!pinned && strength < this.config.pruneThreshold) continue;

      const relevance = query.trim() ? keywordRelevance(query, row.content) : 0.5;
      if (query.trim() && relevance <= 0) continue;

      const score = hybridScore({
        relevance,
        strength,
        importance: row.importance,
        updatedAt: row.updated_at,
        nowIso,
        pin: pinned,
      });
      if (score < minScore && !pinned) continue;

      scored.push({
        id: row.id,
        content: row.content,
        category: row.category,
        scopeKey: row.scope_key,
        strength,
        relevance,
        importance: row.importance,
        freshness: hybridFreshness(row.updated_at, nowIso),
        score,
        visibility: row.visibility,
        pin: pinned,
      });
    }

    scored.sort((a, b) => {
      if (a.pin !== b.pin) return Number(b.pin) - Number(a.pin);
      return b.score - a.score;
    });
    return scored.slice(0, top);
  }

  remember(scope: MemoryScope, draft: MemoryDraft): MemoryId {
    const gate = evaluateDraft(draft);
    if (!gate.ok && gate.reason === "empty") {
      throw new Error("memory draft is empty");
    }
    if (!gate.ok && gate.reason === "sensitive") {
      throw new Error("memory draft rejected as sensitive");
    }

    const key = scopeKey(scope);
    const visibility: MemoryVisibility =
      draft.visibility ?? defaultVisibilityForScope(scope.kind);
    const ownerId =
      draft.ownerId ??
      (scope.kind === "user" || scope.kind === "relation" ? scope.userId : null);
    const groupId =
      draft.groupId ??
      (scope.kind === "group" || scope.kind === "relation" ? scope.groupId : null);

    // Fact-key conflict: archive older active rows with same key.
    if (draft.factKey) {
      for (const old of this.store.findActiveByFactKey(key, draft.factKey)) {
        if (old.pin) continue;
        old.status = "archived";
        old.updated_at = this.now().toISOString();
        this.store.update(old);
      }
    }

    const dup = this.store.findNearDuplicate(key, draft.content);
    const nowIso = this.now().toISOString();

    if (dup) {
      const merged: StoredMemory = {
        ...dup,
        content: draft.content.trim(),
        category: gate.category,
        importance: Math.max(dup.importance, gate.importance),
        confidence: Math.max(dup.confidence, gate.confidence),
        status: gate.status,
        tags_json: JSON.stringify(
          uniqueTags([...(safeJsonTags(dup.tags_json) ?? []), ...(draft.tags ?? [])]),
        ),
        updated_at: nowIso,
        active_days_anchor: nowIso,
        visibility,
        pin: draft.pin || dup.pin ? 1 : 0,
        fact_key: draft.factKey ?? dup.fact_key,
        owner_id: ownerId ?? dup.owner_id,
        group_id: groupId ?? dup.group_id,
      };
      this.store.update(merged);
      return dup.id;
    }

    const id = randomUUID();
    const row: StoredMemory = {
      id,
      scope_key: key,
      content: draft.content.trim(),
      category: gate.category,
      importance: gate.importance,
      confidence: gate.confidence,
      recall_count: 0,
      status: gate.status,
      tags_json: JSON.stringify(draft.tags ?? []),
      created_at: nowIso,
      updated_at: nowIso,
      last_recalled_at: null,
      active_days_anchor: nowIso,
      consolidated_into: null,
      visibility,
      pin: draft.pin ? 1 : 0,
      fact_key: draft.factKey ?? null,
      owner_id: ownerId,
      group_id: groupId,
    };
    this.store.insert(row);
    return id;
  }

  pin(id: MemoryId, pinned = true): void {
    const row = this.store.getById(id);
    if (!row) throw new Error(`memory not found: ${id}`);
    row.pin = pinned ? 1 : 0;
    row.updated_at = this.now().toISOString();
    this.store.update(row);
  }

  setVisibility(id: MemoryId, visibility: MemoryVisibility): void {
    const row = this.store.getById(id);
    if (!row) throw new Error(`memory not found: ${id}`);
    row.visibility = visibility;
    row.updated_at = this.now().toISOString();
    this.store.update(row);
  }

  reinforce(ids: MemoryId[]): void {
    const nowIso = this.now().toISOString();
    for (const id of ids) {
      const row = this.store.getById(id);
      if (!row || row.status !== "active") continue;
      row.recall_count += 1;
      row.last_recalled_at = nowIso;
      row.updated_at = nowIso;
      if (!row.pin) row.active_days_anchor = nowIso;
      this.store.update(row);
    }
  }

  async ingestUtterance(
    scope: MemoryScope,
    text: string,
    extras?: Partial<MemoryDraft>,
  ): Promise<MemoryId[]> {
    const drafts = extractByRules(text).map((d) => ({ ...d, ...extras }));
    if (this.llmExtractor) {
      const extra = await this.llmExtractor([text]);
      drafts.push(...extra.map((d) => ({ ...d, ...extras })));
    }
    return drafts.map((d) => this.remember(scope, d));
  }

  runMaintenance(): {
    pruned: number;
    consolidated: number;
    archived: number;
  } {
    const nowIso = this.now().toISOString();
    let pruned = 0;
    let consolidated = 0;
    let archived = 0;

    const active = this.store.listActive();
    for (const row of active) {
      if (row.pin) continue; // pinned memories never prune
      const cat = resolveCategoryConfig(this.config, row.category);
      const strength = computeStrength({
        importance: row.importance,
        recallCount: row.recall_count,
        activeDays: daysBetween(row.active_days_anchor, nowIso),
        baseLambda: cat.baseLambda,
      });
      if (strength < this.config.pruneThreshold) {
        row.status = "pruned";
        row.updated_at = nowIso;
        this.store.update(row);
        pruned += 1;
      }
    }

    const stillActive = this.store.listActive().filter((r) => !r.pin);
    const plans = planConsolidations(stillActive);
    for (const plan of plans) {
      const keep = this.store.getById(plan.keepId);
      if (!keep || keep.pin) continue;
      keep.content = plan.mergedContent;
      keep.importance = plan.mergedImportance;
      keep.updated_at = nowIso;
      this.store.update(keep);
      consolidated += 1;
      for (const id of plan.archiveIds) {
        const row = this.store.getById(id);
        if (!row || row.pin) continue;
        row.status = "archived";
        row.consolidated_into = plan.keepId;
        row.updated_at = nowIso;
        this.store.update(row);
        archived += 1;
      }
    }

    return { pruned, consolidated, archived };
  }

  get(id: MemoryId): MemoryRecord | undefined {
    const row = this.store.getById(id);
    return row ? toRecord(row) : undefined;
  }

  listPending(): MemoryRecord[] {
    return this.store.listPending().map(toRecord);
  }

  listGraph(limit = 80): MemoryRecord[] {
    return this.store.listGraph(limit).map(toRecord);
  }

  formatEvidenceBlock(evidence: Evidence[], charLimit?: number): string {
    const limit = charLimit ?? this.config.injectCharLimit;
    if (evidence.length === 0) return "";
    const lines: string[] = ["[记忆海]"];
    let used = lines[0]!.length;
    for (const e of evidence) {
      const flags = [e.pin ? "pin" : null, e.visibility !== "public" ? e.visibility : null]
        .filter(Boolean)
        .join(",");
      const meta = flags ? `${e.category}/${flags}` : e.category;
      const line = `- (${meta}, s=${e.strength.toFixed(2)}) ${e.content}`;
      if (used + line.length + 1 > limit) break;
      lines.push(line);
      used += line.length + 1;
    }
    return lines.join("\n");
  }
}

function hybridFreshness(updatedAt: string, nowIso: string): number {
  const days = daysBetween(updatedAt, nowIso);
  return Math.exp((-Math.LN2 * days) / 14);
}

function toRecord(row: StoredMemory): MemoryRecord {
  return {
    id: row.id,
    scopeKey: row.scope_key,
    content: row.content,
    category: row.category,
    importance: row.importance,
    confidence: row.confidence,
    recallCount: row.recall_count,
    status: row.status,
    tags: safeJsonTags(row.tags_json) ?? [],
    visibility: row.visibility,
    pin: Boolean(row.pin),
    factKey: row.fact_key,
    ownerId: row.owner_id,
    groupId: row.group_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRecalledAt: row.last_recalled_at,
    activeDaysAnchor: row.active_days_anchor,
  };
}

function safeJsonTags(raw: string): string[] | null {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : null;
  } catch {
    return null;
  }
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags)];
}
