import type { AppConfig } from "@dsh-memory-sea/shared";
import type { VoiceRuntime } from "./voice-runtime.js";

const LIST_RE = /^(?:\/?配音|\/?音色|\/?配音列表|\/?音色列表)\s*$/;
const SWITCH_RE = /^(?:\/?配音|\/?音色)\s+(\S+)\s*$/;

export function isVoiceAdminCommand(text: string): boolean {
  const t = text.trim();
  return LIST_RE.test(t) || SWITCH_RE.test(t);
}

/**
 * Admin-only:
 * - /配音 | /音色 — list
 * - /配音 晓伊 | /音色 柔声 — switch
 */
export function handleVoiceAdmin(opts: {
  cfg: AppConfig;
  userId: string;
  text: string;
  runtime: VoiceRuntime;
}): { handled: true; reply: string } | { handled: false } {
  const text = opts.text.trim();
  if (!isVoiceAdminCommand(text)) return { handled: false };

  if (!opts.cfg.access.admins.includes(opts.userId)) {
    return { handled: true, reply: "只有管理员可以切换配音。" };
  }

  if (LIST_RE.test(text)) {
    return { handled: true, reply: opts.runtime.formatStatus() };
  }

  const sw = text.match(SWITCH_RE);
  if (sw?.[1]) {
    const result = opts.runtime.switchTo(sw[1]);
    if (!result.ok) return { handled: true, reply: result.error };
    const p = result.preset;
    return {
      handled: true,
      reply: `已切换配音 →「${p.id}」${p.gender}·${p.blurb}\n下一句语音起生效。可发：用语音说我想你了`,
    };
  }

  return { handled: false };
}
