import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type PresencePhase = "active" | "probed" | "diving";

export interface GroupPresence {
  groupId: string;
  phase: PresencePhase;
  lastHumanAt: number;
  lastProbeAt: number;
  /** One-shot hint after leaving dive, consumed on next chat inject. */
  wakeHint?: string;
}

export interface PresenceTickAction {
  groupId: string;
  action: "probe" | "dive";
}

export class PresenceStore {
  private map = new Map<string, GroupPresence>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  get(groupId: string): GroupPresence {
    const existing = this.map.get(groupId);
    if (existing) return existing;
    const now = Date.now();
    const fresh: GroupPresence = {
      groupId,
      phase: "active",
      lastHumanAt: now,
      lastProbeAt: 0,
    };
    this.map.set(groupId, fresh);
    this.save();
    return fresh;
  }

  /**
   * Human spoke in group → wake to active and reset idle clock.
   * Leaving dive/probe attaches a one-shot wakeHint for the next inject.
   */
  noteHumanActivity(groupId: string, at = Date.now()): GroupPresence {
    const row = this.get(groupId);
    const prev = row.phase;
    if (prev === "diving" || prev === "probed") {
      row.wakeHint =
        prev === "diving"
          ? "你刚从潜水状态回来，群里重新有人说话了；接话自然一点，可简短回应冷场后的气氛。"
          : "你刚主动开过话题，现在有人接话了；顺着对方说，不要再重复开场。";
    }
    row.phase = "active";
    row.lastHumanAt = at;
    this.map.set(groupId, row);
    this.save();
    return row;
  }

  consumeWakeHint(groupId: string): string {
    const row = this.map.get(groupId);
    if (!row?.wakeHint) return "";
    const hint = row.wakeHint;
    row.wakeHint = undefined;
    this.map.set(groupId, row);
    this.save();
    return hint;
  }

  markProbed(groupId: string, at = Date.now()): void {
    const row = this.get(groupId);
    row.phase = "probed";
    row.lastProbeAt = at;
    this.map.set(groupId, row);
    this.save();
  }

  markDiving(groupId: string): void {
    const row = this.get(groupId);
    row.phase = "diving";
    this.map.set(groupId, row);
    this.save();
  }

  /**
   * Scan allowlisted groups for idle transitions.
   * Does not mutate until caller confirms (probe send success → markProbed).
   */
  planTicks(
    groupIds: string[],
    opts: { idleOpenMs: number; diveAfterProbeMs: number; now?: number },
  ): PresenceTickAction[] {
    const now = opts.now ?? Date.now();
    const actions: PresenceTickAction[] = [];
    for (const groupId of groupIds) {
      const row = this.get(groupId);
      if (row.phase === "active") {
        if (now - row.lastHumanAt >= opts.idleOpenMs) {
          actions.push({ groupId, action: "probe" });
        }
      } else if (row.phase === "probed") {
        const since = row.lastProbeAt || row.lastHumanAt;
        if (now - since >= opts.diveAfterProbeMs) {
          actions.push({ groupId, action: "dive" });
        }
      }
    }
    return actions;
  }

  list(): GroupPresence[] {
    return [...this.map.values()];
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as GroupPresence[];
      for (const row of raw) {
        if (!row?.groupId) continue;
        this.map.set(row.groupId, {
          groupId: String(row.groupId),
          phase: normalizePhase(row.phase),
          lastHumanAt: Number(row.lastHumanAt) || Date.now(),
          lastProbeAt: Number(row.lastProbeAt) || 0,
          wakeHint: row.wakeHint ? String(row.wakeHint) : undefined,
        });
      }
    } catch {
      // corrupt → start fresh
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.list(), null, 2), "utf8");
  }
}

function normalizePhase(phase: unknown): PresencePhase {
  if (phase === "probed" || phase === "diving" || phase === "active") return phase;
  return "active";
}
