export interface BubbleTiming {
  multiBubble: boolean;
  bubbleGapMinMs: number;
  bubbleGapMaxMs: number;
  typingDelay: boolean;
  typingMsPerChar: number;
  typingMinMs: number;
  typingMaxMs: number;
}

/** Split assistant text into chat bubbles (`|||` preferred, else blank lines). */
export function splitBubbles(text: string, enabled: boolean): string[] {
  const cleaned = String(text ?? "").trim();
  if (!cleaned) return [];
  if (!enabled) return [cleaned];

  if (cleaned.includes("|||")) {
    return cleaned
      .split("|||")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const byBlank = cleaned
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (byBlank.length > 1 && byBlank.length <= 5) return byBlank;
  return [cleaned];
}

export function typingDelayMs(text: string, timing: BubbleTiming): number {
  if (!timing.typingDelay) return 0;
  const raw = text.length * timing.typingMsPerChar;
  return Math.min(timing.typingMaxMs, Math.max(timing.typingMinMs, Math.round(raw)));
}

export function bubbleGapMs(timing: BubbleTiming): number {
  const min = timing.bubbleGapMinMs;
  const max = Math.max(min, timing.bubbleGapMaxMs);
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}
