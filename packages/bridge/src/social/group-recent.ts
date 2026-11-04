export interface RecentLine {
  userId: string;
  nickname: string;
  text: string;
  at: number;
}

/** In-memory recent group utterances with speaker labels (not mixed into DSH history). */
export class GroupRecentLog {
  private readonly byGroup = new Map<string, RecentLine[]>();

  constructor(private readonly limit = 12) {}

  push(groupId: string, line: Omit<RecentLine, "at">): void {
    const list = this.byGroup.get(groupId) ?? [];
    list.push({ ...line, at: Date.now() });
    while (list.length > this.limit) list.shift();
    this.byGroup.set(groupId, list);
  }

  /** Format others' recent lines for inject; exclude current speaker's last identical line. */
  formatContext(groupId: string, currentUserId: string): string {
    const list = this.byGroup.get(groupId) ?? [];
    if (!list.length) return "";
    const lines = list
      .filter((l) => l.userId !== currentUserId)
      .slice(-8)
      .map((l) => `- 「${l.nickname}」(QQ:${l.userId})：${l.text}`);
    if (!lines.length) return "";
    return (
      `【群内其他人最近说过（仅背景，不要当成当前发言人说的）】\n${lines.join("\n")}`
    );
  }
}
