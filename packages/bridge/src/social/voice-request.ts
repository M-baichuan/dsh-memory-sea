/** User asked for a spoken reply this turn. */
const ASK_VOICE_RE =
  /用语音\s*回复|语音\s*回复|请用语音|用语音说|语音说(?:一下|吧)?|发(?:个|一条)?语音|说语音|语音聊|voice\s*reply/i;

/** Explicitly cancel voice for this turn (wins over ask). */
const NO_VOICE_RE = /不用语音|别发语音|不要语音|文字回复|用文字/;

export function userAskedForVoice(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (NO_VOICE_RE.test(t)) return false;
  return ASK_VOICE_RE.test(t);
}
