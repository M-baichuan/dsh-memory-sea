import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface QzoneDraft {
  content: string;
  /** Content style id, e.g. 心情 / 日常 */
  typeId?: string;
  hint?: string;
  createdBy: string;
  createdAt: string;
}

interface DraftFile {
  byUser: Record<string, QzoneDraft>;
}

/**
 * Per-admin drafts so two admins don't overwrite each other.
 * Migrates legacy single-draft JSON on first read.
 */
export class QzoneDraftStore {
  constructor(private readonly filePath: string) {}

  get(userId: string): QzoneDraft | null {
    const file = this.load();
    const raw = file.byUser[String(userId)];
    if (!raw?.content?.trim()) return null;
    return normalizeDraft(raw);
  }

  set(draft: QzoneDraft): void {
    const uid = String(draft.createdBy || "").trim();
    if (!uid) return;
    const file = this.load();
    file.byUser[uid] = normalizeDraft({ ...draft, createdBy: uid })!;
    this.save(file);
  }

  clear(userId: string): void {
    const uid = String(userId || "").trim();
    if (!uid) return;
    const file = this.load();
    if (!(uid in file.byUser)) return;
    delete file.byUser[uid];
    this.save(file);
  }

  private load(): DraftFile {
    try {
      if (!existsSync(this.filePath)) return { byUser: {} };
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as
        | DraftFile
        | QzoneDraft
        | { clearedAt?: string };
      if (raw && typeof raw === "object" && "byUser" in raw && raw.byUser) {
        const byUser: Record<string, QzoneDraft> = {};
        for (const [k, v] of Object.entries(raw.byUser)) {
          const n = normalizeDraft(v);
          if (n) byUser[k] = n;
        }
        return { byUser };
      }
      // Legacy single draft
      const legacy = normalizeDraft(raw as QzoneDraft);
      if (legacy?.createdBy) {
        return { byUser: { [legacy.createdBy]: legacy } };
      }
      return { byUser: {} };
    } catch {
      return { byUser: {} };
    }
  }

  private save(file: DraftFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(file, null, 2), "utf8");
  }
}

function normalizeDraft(raw: unknown): QzoneDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as QzoneDraft;
  if (!d.content?.trim()) return null;
  return {
    content: String(d.content).trim(),
    typeId: d.typeId ? String(d.typeId) : undefined,
    hint: d.hint ? String(d.hint) : undefined,
    createdBy: String(d.createdBy || ""),
    createdAt: String(d.createdAt || new Date().toISOString()),
  };
}
