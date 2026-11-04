const WHISPER_RE =
  /^(?:悄悄话|密语|私聊我)\s*[:：]\s*(.+)$/s;
const WHISPER_SLASH_RE = /^\/(?:悄悄话|密语)\s+(.+)$/s;

export function parseWhisper(text: string): { ok: true; body: string } | { ok: false } {
  const t = String(text ?? "").trim();
  if (!t) return { ok: false };
  const m = t.match(WHISPER_RE) ?? t.match(WHISPER_SLASH_RE);
  if (!m?.[1]?.trim()) return { ok: false };
  return { ok: true, body: m[1].trim() };
}

export function whisperGroupAck(): string {
  const pool = ["嗯。", "收到。", "私聊你。", "好。"];
  return pool[Math.floor(Math.random() * pool.length)]!;
}
