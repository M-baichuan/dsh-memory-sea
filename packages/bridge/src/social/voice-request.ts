/**
 * User asked the bot to reply with voice this turn.
 * Keep patterns loose around 语音…说 / 语音回复，避免漏掉口语。
 */
const ASK_VOICE_RE =
  /用语音\s*回复|语音\s*回复|请用语音|用语音说|语音聊|发(?:个|一条)?语音|说语音|voice\s*reply|语音\s*(?:给\s*我\s*)?说(?:一\s*遍|一下|吧)?|给\s*我\s*(?:用\s*)?语音|用\s*语音\s*(?:回|说)|说一句|念一句|读一句/i;

/** Explicitly cancel voice for this turn (wins over ask). */
const NO_VOICE_RE = /不用语音|别发语音|不要语音|文字回复|用文字/;

/**
 * 「用语音说我想你了」/「说一句我想你了」→ 直接念该短句，不走模型。
 * 必须带要念的正文；光「用语音」不算。
 */
const DIRECT_SPEAK_PATTERNS: RegExp[] = [
  /^(?:请)?用语音说(?:一句)?\s*[「『""']?(.+?)[」』""']?\s*$/u,
  /^(?:请)?语音说(?:一句)?\s*[「『""']?(.+?)[」』""']?\s*$/u,
  /^(?:说一句|念一句|读一句)\s*[「『""']?(.+?)[」』""']?\s*$/u,
  /^语音\s*给\s*我\s*说(?:一\s*遍|一下)?\s*[「『""']?(.+?)[」』""']?\s*$/u,
];

export function userAskedForVoice(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (NO_VOICE_RE.test(t)) return false;
  return ASK_VOICE_RE.test(t) || Boolean(parseDirectSpeakLine(t));
}

/** If user only wants a fixed line spoken, return that line. */
export function parseDirectSpeakLine(text: string): string | null {
  const t = String(text ?? "").trim();
  if (!t) return null;
  if (NO_VOICE_RE.test(t)) return null;
  for (const re of DIRECT_SPEAK_PATTERNS) {
    const m = t.match(re);
    const line = m?.[1]?.trim();
    if (!line || line.length > 80) continue;
    if (/^(?:吧|啊|呀|呢|一遍|一下)?$/.test(line)) continue;
    // 「用语音说」误吞进正文时丢掉
    if (/^(?:一句|语音|用语音)/.test(line)) continue;
    return line;
  }
  return null;
}
