import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface AutonomyMuteState {
  /** Global kill switch (admin 「闭嘴」). */
  muted: boolean;
  /** Per-group mute. */
  mutedGroups: string[];
  updatedAt: string;
}

interface QuotaBucket {
  key: string;
  stamps: number[];
}

interface PrivateIdleFile {
  /** Last time owner messaged her in private. */
  lastHumanAt: Record<string, number>;
  /** Last time she autonomously messaged this private user. */
  lastActAt: Record<string, number>;
}

/**
 * Hard policy for L1/L2 autonomy: mute, quiet hours, hourly quotas, private idle.
 * Code-enforced — model cannot bypass.
 */
export class AutonomyPolicy {
  private mute: AutonomyMuteState = {
    muted: false,
    mutedGroups: [],
    updatedAt: new Date().toISOString(),
  };
  private buckets = new Map<string, number[]>();
  private lastHumanAt = new Map<string, number>();
  private lastActAt = new Map<string, number>();

  constructor(private readonly statePath: string) {
    this.load();
  }

  isGloballyMuted(): boolean {
    return this.mute.muted;
  }

  isGroupMuted(groupId: string): boolean {
    return this.mute.mutedGroups.includes(String(groupId));
  }

  setGlobalMute(muted: boolean): void {
    this.mute.muted = muted;
    this.mute.updatedAt = new Date().toISOString();
    this.save();
  }

  setGroupMute(groupId: string, muted: boolean): void {
    const id = String(groupId);
    const set = new Set(this.mute.mutedGroups);
    if (muted) set.add(id);
    else set.delete(id);
    this.mute.mutedGroups = [...set];
    this.mute.updatedAt = new Date().toISOString();
    this.save();
  }

  /** Owner (or any tracked user) spoke in private — reset private idle clock. */
  notePrivateHuman(userId: string, at = Date.now()): void {
    const id = String(userId);
    if (!id) return;
    this.lastHumanAt.set(id, at);
    this.save();
  }

  notePrivateAct(userId: string, at = Date.now()): void {
    const id = String(userId);
    if (!id) return;
    this.lastActAt.set(id, at);
    this.save();
  }

  /**
   * True if enough time passed since last human private msg AND last autonomous DM.
   */
  privateIdleOk(userId: string, minIdleMs: number, now = Date.now()): boolean {
    const id = String(userId);
    const lastHuman = this.lastHumanAt.get(id) ?? 0;
    const lastAct = this.lastActAt.get(id) ?? 0;
    const latest = Math.max(lastHuman, lastAct);
    if (!latest) return true;
    return now - latest >= minIdleMs;
  }

  msUntilPrivateReady(userId: string, minIdleMs: number, now = Date.now()): number {
    const id = String(userId);
    const lastHuman = this.lastHumanAt.get(id) ?? 0;
    const lastAct = this.lastActAt.get(id) ?? 0;
    const latest = Math.max(lastHuman, lastAct);
    if (!latest) return 0;
    return Math.max(0, minIdleMs - (now - latest));
  }

  /** Milliseconds since last private human or autonomous contact (huge if never). */
  privateIdleElapsed(userId: string, now = Date.now()): number {
    const id = String(userId);
    const lastHuman = this.lastHumanAt.get(id) ?? 0;
    const lastAct = this.lastActAt.get(id) ?? 0;
    const latest = Math.max(lastHuman, lastAct);
    if (!latest) return Number.MAX_SAFE_INTEGER / 4;
    return Math.max(0, now - latest);
  }

  formatStatus(extra?: string): string {
    const lines = [
      `自主：${this.mute.muted ? "闭嘴中" : "开口中"}`,
      this.mute.mutedGroups.length
        ? `群静音：${this.mute.mutedGroups.join("、")}`
        : "群静音：无",
    ];
    if (extra) lines.push(extra);
    lines.push("命令：闭嘴 / 开口 / 自主状态 / 群闭嘴 / 群开口");
    return lines.join("\n");
  }

  /** Local quiet hours [startHour, endHour) — wraps midnight. */
  inQuietHours(
    quiet?: { startHour: number; endHour: number } | null,
    now = new Date(),
  ): boolean {
    if (!quiet) return false;
    const h = now.getHours();
    const s = ((quiet.startHour % 24) + 24) % 24;
    const e = ((quiet.endHour % 24) + 24) % 24;
    if (s === e) return false;
    if (s < e) return h >= s && h < e;
    return h >= s || h < e;
  }

  canAct(
    scopeKey: string,
    opts: { isPrivate: boolean; maxPerHour: number; maxPrivatePerHour: number },
  ): { ok: true } | { ok: false; reason: string } {
    if (this.mute.muted) return { ok: false, reason: "全局闭嘴" };
    const limit = opts.isPrivate ? opts.maxPrivatePerHour : opts.maxPerHour;
    if (limit <= 0) return { ok: false, reason: "配额为 0" };
    const stamps = this.prune(scopeKey);
    if (stamps.length >= limit) {
      return { ok: false, reason: `本小时已达上限 ${limit}` };
    }
    return { ok: true };
  }

  recordAct(scopeKey: string): void {
    const stamps = this.prune(scopeKey);
    stamps.push(Date.now());
    this.buckets.set(scopeKey, stamps);
    this.saveBuckets();
  }

  private prune(scopeKey: string, now = Date.now()): number[] {
    const hourAgo = now - 60 * 60_000;
    const stamps = (this.buckets.get(scopeKey) ?? []).filter((t) => t >= hourAgo);
    this.buckets.set(scopeKey, stamps);
    return stamps;
  }

  private load(): void {
    if (!existsSync(this.statePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.statePath, "utf8")) as {
        mute?: AutonomyMuteState;
        buckets?: QuotaBucket[];
        privateIdle?: PrivateIdleFile;
      };
      if (raw.mute) {
        this.mute = {
          muted: Boolean(raw.mute.muted),
          mutedGroups: Array.isArray(raw.mute.mutedGroups)
            ? raw.mute.mutedGroups.map(String)
            : [],
          updatedAt: String(raw.mute.updatedAt || new Date().toISOString()),
        };
      }
      if (Array.isArray(raw.buckets)) {
        for (const b of raw.buckets) {
          if (!b?.key || !Array.isArray(b.stamps)) continue;
          this.buckets.set(String(b.key), b.stamps.map(Number).filter(Boolean));
        }
      }
      if (raw.privateIdle) {
        for (const [k, v] of Object.entries(raw.privateIdle.lastHumanAt || {})) {
          this.lastHumanAt.set(k, Number(v) || 0);
        }
        for (const [k, v] of Object.entries(raw.privateIdle.lastActAt || {})) {
          this.lastActAt.set(k, Number(v) || 0);
        }
      }
    } catch {
      /* fresh */
    }
  }

  private save(): void {
    this.saveBuckets();
  }

  private saveBuckets(): void {
    mkdirSync(path.dirname(this.statePath), { recursive: true });
    const privateIdle: PrivateIdleFile = {
      lastHumanAt: Object.fromEntries(this.lastHumanAt),
      lastActAt: Object.fromEntries(this.lastActAt),
    };
    const payload = {
      mute: this.mute,
      buckets: [...this.buckets.entries()].map(([key, stamps]) => ({
        key,
        stamps: this.prune(key),
      })),
      privateIdle,
    };
    writeFileSync(this.statePath, JSON.stringify(payload, null, 2), "utf8");
  }
}

export function scopeKeyFor(opts: { groupId?: string; userId?: string }): string {
  if (opts.groupId) return `group:${opts.groupId}`;
  return `private:${opts.userId || "?"}`;
}
