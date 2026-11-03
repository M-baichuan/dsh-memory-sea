import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface PersonaCard {
  userId: string;
  nickname?: string;
  callMe?: string;
  notes: string[];
  updatedAt: string;
}

export class PersonaCardStore {
  private map = new Map<string, PersonaCard>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  get(userId: string): PersonaCard | undefined {
    return this.map.get(userId);
  }

  formatForInject(userId: string): string {
    const card = this.map.get(userId);
    if (!card) return "";
    const bits: string[] = [];
    if (card.nickname) bits.push(`对方昵称：${card.nickname}`);
    if (card.callMe) bits.push(`对方希望你这样叫他/她：${card.callMe}`);
    if (card.notes.length) bits.push(`仅关于此人的备忘：${card.notes.slice(-3).join("；")}`);
    if (!bits.length) return "";
    return (
      `【人物小传——仅描述 QQ:${userId}，不要套到别人头上】\n- ${bits.join("\n- ")}`
    );
  }

  /** Heuristic learn from a user utterance (call-name / self-name). */
  learnFromUtterance(userId: string, text: string, nickname?: string): void {
    const card = this.map.get(userId) ?? {
      userId,
      notes: [],
      updatedAt: new Date().toISOString(),
    };
    if (nickname?.trim()) card.nickname = nickname.trim().slice(0, 32);

    const callMe =
      text.match(/(?:叫我|称呼我|我叫)\s*[「『]?([^\s，。！？「」『』]{1,12})/)?.[1] ??
      text.match(/我是\s*([^\s，。！？]{1,12})/)?.[1];
    if (callMe) card.callMe = callMe;

    const noteHit = text.match(/(喜欢|讨厌|不要|记得)\s*.{1,20}/);
    if (noteHit?.[0]) {
      card.notes.push(noteHit[0].slice(0, 40));
      if (card.notes.length > 8) card.notes = card.notes.slice(-8);
    }

    card.updatedAt = new Date().toISOString();
    this.map.set(userId, card);
    this.save();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, "utf8")) as PersonaCard[];
      for (const row of raw) {
        if (!row?.userId) continue;
        this.map.set(String(row.userId), {
          userId: String(row.userId),
          nickname: row.nickname,
          callMe: row.callMe,
          notes: Array.isArray(row.notes) ? row.notes.map(String) : [],
          updatedAt: row.updatedAt || new Date().toISOString(),
        });
      }
    } catch {
      /* ignore */
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(
      this.filePath,
      JSON.stringify([...this.map.values()], null, 2),
      "utf8",
    );
  }
}
