import type { AppConfig } from "@dsh-memory-sea/shared";
import type { AutonomyPolicy } from "./autonomy-policy.js";
import { allowedToolNames, resolveToolFlags } from "./autonomy-tools.js";

const MUTE_RE = /^(?:\/?闭嘴|\/?自主闭嘴)\s*$/;
const UNMUTE_RE = /^(?:\/?开口|\/?自主开口)\s*$/;
const STATUS_RE = /^(?:\/?自主状态|\/?自主)\s*$/;
const GROUP_MUTE_RE = /^(?:\/?群闭嘴)\s*$/;
const GROUP_UNMUTE_RE = /^(?:\/?群开口)\s*$/;

export function isAutonomyAdminCommand(text: string): boolean {
  const t = text.trim();
  return (
    MUTE_RE.test(t) ||
    UNMUTE_RE.test(t) ||
    STATUS_RE.test(t) ||
    GROUP_MUTE_RE.test(t) ||
    GROUP_UNMUTE_RE.test(t)
  );
}

/** Admin: 闭嘴 / 开口 / 自主状态 / 群闭嘴 / 群开口 */
export function handleAutonomyAdmin(opts: {
  cfg: AppConfig;
  userId: string;
  groupId?: string;
  text: string;
  policy: AutonomyPolicy;
}): { handled: true; reply: string } | { handled: false } {
  const text = opts.text.trim();
  if (!isAutonomyAdminCommand(text)) return { handled: false };

  const isAdmin = opts.cfg.access.admins.includes(opts.userId);
  if (!isAdmin) {
    return { handled: true, reply: "自主开关只有管理员能拧。" };
  }

  const auto = opts.cfg.social.autonomy;
  if (!auto?.enabled) {
    return {
      handled: true,
      reply: "config 里 social.autonomy.enabled 还是关的，开口也转不起来。",
    };
  }

  if (MUTE_RE.test(text)) {
    opts.policy.setGlobalMute(true);
    return { handled: true, reply: "好，我闭嘴。再说「开口」才继续自主。" };
  }

  if (UNMUTE_RE.test(text)) {
    opts.policy.setGlobalMute(false);
    return { handled: true, reply: "嗯，开口了。冷场时我会自己掂量要不要动。" };
  }

  if (GROUP_MUTE_RE.test(text)) {
    if (!opts.groupId) {
      return { handled: true, reply: "群闭嘴请在群里发。" };
    }
    opts.policy.setGroupMute(opts.groupId, true);
    return { handled: true, reply: "这个群我先不主动插话了。" };
  }

  if (GROUP_UNMUTE_RE.test(text)) {
    if (!opts.groupId) {
      return { handled: true, reply: "群开口请在群里发。" };
    }
    opts.policy.setGroupMute(opts.groupId, false);
    return { handled: true, reply: "这个群恢复自主了。" };
  }

  if (STATUS_RE.test(text)) {
    const tools = allowedToolNames(resolveToolFlags(opts.cfg));
    const privWait = opts.policy.msUntilPrivateReady(
      opts.userId,
      auto.minPrivateIdleMs ?? 30 * 60_000,
    );
    const privReady =
      auto.allowPrivate === false
        ? "私聊主动：关"
        : privWait > 0
          ? `私聊主动：约 ${Math.ceil(privWait / 60_000)} 分钟后可再找你`
          : "私聊主动：现在可以找你";
    const extra = [
      `开关：on · 胆量 ${auto.assertiveness ?? "high"} · tick ${Math.round(auto.tickMs / 1000)}s · 群闲置≥${Math.round(auto.minGroupIdleMs / 60_000)}分钟`,
      `配额：群 ${auto.maxPerHour}/时 · 私聊 ${auto.maxPrivatePerHour}/时`,
      `静默时段：${auto.quietStartHour}:00–${auto.quietEndHour}:00`,
      privReady,
      `工具：${tools.join(", ")}`,
      opts.groupId
        ? `本群静音：${opts.policy.isGroupMuted(opts.groupId) ? "是" : "否"}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    return { handled: true, reply: opts.policy.formatStatus(extra) };
  }

  return { handled: false };
}
