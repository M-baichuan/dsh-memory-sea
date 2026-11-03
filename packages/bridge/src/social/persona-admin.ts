import type { AppConfig } from "@dsh-memory-sea/shared";
import type { PersonaRuntime } from "./persona-runtime.js";

const LIST_RE = /^(?:\/?性格|\/?人设列表)\s*$/;
const RELOAD_RE = /^(?:\/?人设重载|\/?性格重载)\s*$/;
const SWITCH_RE = /^(?:\/?人设|\/?性格切换)\s+(\S+)\s*$/;
const HELP_RE = /^(?:\/?人设)\s*$/;

export function isPersonaAdminCommand(text: string): boolean {
  const t = text.trim();
  return LIST_RE.test(t) || RELOAD_RE.test(t) || SWITCH_RE.test(t) || HELP_RE.test(t);
}

/**
 * Admin-only QQ commands:
 * - /性格 | /人设列表 — list presets
 * - /人设 <名称> — switch
 * - /人设重载 — reload current from disk
 */
export async function handlePersonaAdmin(opts: {
  cfg: AppConfig;
  userId: string;
  text: string;
  runtime: PersonaRuntime;
}): Promise<{ handled: true; reply: string } | { handled: false }> {
  const text = opts.text.trim();
  if (!isPersonaAdminCommand(text)) return { handled: false };

  const isAdmin = opts.cfg.access.admins.includes(opts.userId);
  if (!isAdmin) {
    return { handled: true, reply: "只有管理员可以切换人设。" };
  }

  if (LIST_RE.test(text) || HELP_RE.test(text)) {
    return { handled: true, reply: opts.runtime.formatStatus() };
  }

  if (RELOAD_RE.test(text)) {
    const result = await opts.runtime.reload();
    if (!result.ok) {
      return { handled: true, reply: `重载失败：${result.error}` };
    }
    const label = result.id ?? "文件人设";
    return { handled: true, reply: `已重载人设「${label}」。下一句起生效。` };
  }

  const sw = text.match(SWITCH_RE);
  if (sw?.[1]) {
    const result = await opts.runtime.switchTo(sw[1]);
    if (!result.ok) {
      return { handled: true, reply: result.error };
    }
    return { handled: true, reply: `已切换人设 →「${result.id}」。下一句起生效。` };
  }

  return { handled: false };
}
