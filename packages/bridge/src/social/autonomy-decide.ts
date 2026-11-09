/**
 * Parse model output into a single whitelist autonomy decision.
 * Prefer JSON; tolerate ```json fences and trailing chatter.
 */

export type AutonomyAction =
  | "noop"
  | "send_text"
  | "send_sticker"
  | "send_voice"
  | "schedule_nudge"
  | "draft_qzone";

export type AutonomyChannel = "group" | "private";
export type AutonomyAssertiveness = "low" | "normal" | "high";

export interface AutonomyDecision {
  action: AutonomyAction;
  channel?: AutonomyChannel;
  /** Short reason for logs (optional). */
  reason?: string;
  text?: string;
  sticker?: string;
  /** For schedule_nudge: "30分钟后 喝水" style. */
  dueHint?: string;
  /** Target user for private / nudge (digits). */
  userId?: string;
  /** QZone draft type id, e.g. 日常. */
  qzoneType?: string;
  qzoneHint?: string;
}

const ACTIONS = new Set<AutonomyAction>([
  "noop",
  "send_text",
  "send_sticker",
  "send_voice",
  "schedule_nudge",
  "draft_qzone",
]);

export function parseAutonomyDecision(raw: string): AutonomyDecision {
  const extracted = extractJsonObject(raw);
  if (!extracted) return { action: "noop", reason: "unparseable" };

  const actionRaw = String(extracted.action ?? extracted.tool ?? "noop")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  const action = (ACTIONS.has(actionRaw as AutonomyAction)
    ? actionRaw
    : "noop") as AutonomyAction;

  const channelRaw = String(extracted.channel ?? extracted.target ?? "")
    .trim()
    .toLowerCase();
  const channel: AutonomyChannel | undefined =
    channelRaw === "private" || channelRaw === "dm" || channelRaw === "私聊"
      ? "private"
      : channelRaw === "group" || channelRaw === "群"
        ? "group"
        : undefined;

  const text = pickStr(extracted, ["text", "message", "content", "say"]);
  const sticker = pickStr(extracted, ["sticker", "mood", "stickerId", "emoji"]);
  const dueHint = pickStr(extracted, ["dueHint", "due", "when", "nudge"]);
  const userId = pickStr(extracted, ["userId", "qq", "to"]).replace(/\D/g, "");
  const qzoneType = pickStr(extracted, ["qzoneType", "type"]);
  const qzoneHint = pickStr(extracted, ["qzoneHint", "hint"]);
  const reason = pickStr(extracted, ["reason", "why"]);

  return {
    action,
    channel,
    reason: reason || undefined,
    text: text || undefined,
    sticker: sticker || undefined,
    dueHint: dueHint || undefined,
    userId: userId || undefined,
    qzoneType: qzoneType || undefined,
    qzoneHint: qzoneHint || undefined,
  };
}

export function buildAutonomyDecidePrompt(input: {
  systemPrompt: string;
  channel: AutonomyChannel;
  groupId?: string;
  ownerUserId?: string;
  idleMinutes: number;
  minIdleMinutes: number;
  recent: string;
  allowedTools: string[];
  stickerIds: string[];
  assertiveness: AutonomyAssertiveness;
  now?: Date;
}): string {
  const stickers =
    input.stickerIds.length > 0
      ? input.stickerIds.slice(0, 24).join("、")
      : "（暂无）";
  const bias = assertivenessLines(input.assertiveness);
  const tod = timeOfDayHint(input.now ?? new Date());
  const idleBand = idleBandHint(input.idleMinutes, input.minIdleMinutes);
  const where =
    input.channel === "private"
      ? `目标：私聊主人 QQ:${input.ownerUserId || "?"}`
      : `目标：群 ${input.groupId || "?"}`;

  return [
    "【人设·勿复述】",
    input.systemPrompt.trim(),
    "",
    "【自主决策任务】",
    "你是挂在 QQ 上的自己。现在轮到你决定要不要主动做一件小事。",
    ...bias,
    "禁止：刷屏、连环追问、扮演系统、提自己是 AI、越权管理群。",
    "空间动态只能 draft_qzone（写草稿等管理员确认），不能直接发。",
    input.channel === "private"
      ? "这是私聊：语气可以更贴身一点，像忽然想起对方；仍要短，不要审问。"
      : "这是群聊：轻量在场即可，不要点名逼问某人。",
    "",
    where,
    `时段：${tod}`,
    `已安静约 ${input.idleMinutes} 分钟（阈值 ${input.minIdleMinutes} 分钟）· ${idleBand}`,
    input.recent ? `最近聊天摘录：\n${input.recent}` : "最近聊天摘录：（空）",
    `可用表情 id：${stickers}`,
    `允许的 action：${input.allowedTools.join(", ")}`,
    "",
    "只输出一个 JSON 对象，不要其它文字。字段：",
    '{"action":"noop|send_text|send_sticker|send_voice|schedule_nudge|draft_qzone",',
    `"channel":"${input.channel}",`,
    '"reason":"一句原因",',
    '"text":"若说话/语音要说的内容，短",',
    '"sticker":"表情 id 或心情词",',
    '"dueHint":"若约定：如 30分钟后 喝水",',
    '"userId":"若约定要提醒的 QQ 号",',
    '"qzoneType":"心情|日常|随想…","qzoneHint":"草稿灵感"}',
  ].join("\n");
}

export function assertivenessLines(level: AutonomyAssertiveness): string[] {
  if (level === "high") {
    return [
      "闲置已够久时，优先做一件轻量在场动作（说话或表情）；只有气氛真不合适才 noop。",
      "有现成表情时，偶尔用 send_sticker 比干巴巴文字更自然；不要每轮都贴图。",
      "不要连续冷场装作不存在；可以碎碎念、轻轻关心，但每轮只做一件事。",
    ];
  }
  if (level === "low") {
    return [
      "多数时候应选择 noop（沉默）。只有在非常自然、不打扰、符合人设时才行动。",
    ];
  }
  return [
    "可以行动也可以沉默：有自然话题或表情就动一下；没把握就 noop。",
  ];
}

export function timeOfDayHint(now: Date): string {
  const h = now.getHours();
  if (h >= 5 && h < 11) return "早上";
  if (h >= 11 && h < 14) return "午间";
  if (h >= 14 && h < 18) return "下午";
  if (h >= 18 && h < 23) return "晚上";
  return "深夜";
}

export function idleBandHint(idleMinutes: number, minIdleMinutes: number): string {
  if (idleMinutes < minIdleMinutes) return "未到阈值";
  if (idleMinutes < minIdleMinutes * 2) return "刚过阈值，轻触即可";
  if (idleMinutes < minIdleMinutes * 4) return "已经挺安静了，适合主动一点";
  return "冷场很久了，可以温柔地冒个泡";
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() || text;

  const tryParse = (s: string) => {
    try {
      const v = JSON.parse(s) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return v as Record<string, unknown>;
      }
    } catch {
      /* */
    }
    return null;
  };

  const direct = tryParse(body);
  if (direct) return direct;

  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return tryParse(body.slice(start, end + 1));
  }
  return null;
}
