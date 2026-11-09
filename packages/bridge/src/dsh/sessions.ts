import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

export interface SessionMapping {
  qqKey: string;
  sessionId: string;
  title: string;
  updatedAt: string;
}

export class SessionStore {
  private map = new Map<string, SessionMapping>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  get(qqKey: string): SessionMapping | undefined {
    const row = this.map.get(qqKey);
    if (row && isPlaceholderSessionId(row.sessionId)) {
      this.map.delete(qqKey);
      this.save();
      return undefined;
    }
    return row;
  }

  set(mapping: SessionMapping): void {
    if (isPlaceholderSessionId(mapping.sessionId)) return;
    this.map.set(mapping.qqKey, mapping);
    this.save();
  }

  delete(qqKey: string): void {
    if (!this.map.delete(qqKey)) return;
    this.save();
  }

  list(): SessionMapping[] {
    return [...this.map.values()];
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as SessionMapping[];
      let dirty = false;
      for (const row of raw) {
        if (isPlaceholderSessionId(row.sessionId)) {
          dirty = true;
          continue;
        }
        this.map.set(row.qqKey, row);
      }
      if (dirty) this.save();
    } catch {
      // ignore corrupt state; start fresh
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.list(), null, 2), "utf8");
  }
}

/**
 * Session key per speaker.
 * Groups use group:<gid>:u:<uid> so DSH history won't mix 群友A's words into 群友B.
 */
export function qqSessionKey(opts: { userId: string; groupId?: string }): string {
  if (opts.groupId) return `group:${opts.groupId}:u:${opts.userId}`;
  return `private:${opts.userId}`;
}

/** Old plugin-fallback IDs that never exist on Desktop Host. */
export function isPlaceholderSessionId(sessionId: string | undefined): boolean {
  return !sessionId || sessionId.startsWith("local:");
}
