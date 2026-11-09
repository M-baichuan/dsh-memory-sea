import { resolveOwnerQq } from "./eye.js";
import type { AppConfig } from "@dsh-memory-sea/shared";

export interface HowtoTopic {
  id: string;
  /** Match aliases (lowercase / original). */
  aliases: string[];
  guide: string;
}

/** Owner-only cheat sheets. Keep concise for QQ. */
export const HOWTO_TOPICS: HowtoTopic[] = [
  {
    id: "skills",
    aliases: ["技能", "技能列表", "你会什么", "总览", "菜单"],
    guide: [
      "技能总览：私聊/群发「技能」可看短菜单。",
      "要点名某一项时说：教程 眼睛 / 怎么用 知识库 / 用法 自主",
      "（只有你私聊这样问才会回详细教程。）",
    ].join("\n"),
  },
  {
    id: "promise",
    aliases: ["小约定", "约定", "提醒", "promises"],
    guide: [
      "小约定",
      "· 约定 30分钟后 喝水",
      "· 约定 明天20:00 交材料",
      "· 约定 周五 记得打电话",
      "· 看看约定",
      "· 取消约定 / 取消约定 1",
      "→ 到点私聊提醒你（不在群里喊）",
    ].join("\n"),
  },
  {
    id: "whisper",
    aliases: ["悄悄话", "群悄悄话", "whisper"],
    guide: [
      "悄悄话（在群里用）",
      "· 悄悄话：今天有点累",
      "· /悄悄话 今天有点累",
      "→ 群里只回一句短确认，正文只私聊回你",
    ].join("\n"),
  },
  {
    id: "sticker",
    aliases: ["表情", "表情导演", "配个表情", "表情包", "sticker"],
    guide: [
      "表情",
      "· 配个表情 无语 / 表情列表",
      "· （管理员）带图：收藏表情 开心",
      "· 聊天里她可写 [[sticker:开心]] 或 [[搜表情:无语]]",
      "→ 本地库优先；搜表情走 QQ 系统表情/收藏（不是客户端商城搜梗）",
    ].join("\n"),
  },
  {
    id: "recall",
    aliases: ["回看", "回看切片", "回忆", "recall"],
    guide: [
      "回看切片",
      "· 回看 上周说烦的事",
      "· 你还记得 火锅",
      "→ 从记忆海捞碎片，用人设口吻轻声复述（不逐字笔录）",
    ].join("\n"),
  },
  {
    id: "taste",
    aliases: ["口味", "口味地图", "偏好", "taste"],
    guide: [
      "口味地图",
      "· 口味地图",
      "· 我喜欢 火锅",
      "· 我不喜欢 香菜",
      "· 忘掉口味 香菜",
      "→ 闲聊提到喜欢/讨厌也会记一点，注入对话但不当事档案",
    ].join("\n"),
  },
  {
    id: "eye",
    aliases: ["眼睛", "摄像头", "看看外面", "保险柜", "眼睛相册", "eye"],
    guide: [
      "眼睛 + 加密相册（仅你 + 口令；需本机 pnpm eye）",
      "· 看看外面 口令",
      "· 眼睛相册 口令",
      "· 再看一眼 1 口令",
      "· 删除眼睛 1 口令",
      "口令：config social.eye.secret（或不带口令当闲聊，不报错）",
      "详见 docs/记忆海-眼睛说明.txt",
    ].join("\n"),
  },
  {
    id: "knowledge",
    aliases: ["知识库", "知识", "入库", "rag", "kb"],
    guide: [
      "知识库",
      "· 知识库 / 知识列表 / 知识搜 关键词",
      "· （管理员）知识入库",
      "· （管理员）知识删 文档名 / 知识重载",
      "文件放 data/knowledge/inbox（.md / .txt / .pdf）后再入库",
      "聊天会自动检索注入；详见 docs/记忆海-知识库说明.txt",
    ].join("\n"),
  },
  {
    id: "autonomy",
    aliases: ["自主", "闭嘴", "开口", "自主状态", "autonomy"],
    guide: [
      "自主（需 social.autonomy.enabled）",
      "· 自主状态 / 自主",
      "· 闭嘴 / 开口",
      "· 群闭嘴 / 群开口",
      "群冷场会更勤插话；也会主动私聊找你（你回过她会歇一阵）",
      "白名单：说话 / 表情 / 约定提醒 / 空间草稿（不直发）",
      "详见 docs/记忆海-自主说明.txt",
    ].join("\n"),
  },
  {
    id: "qzone",
    aliases: ["空间", "动态", "说说", "发条动态", "qzone"],
    guide: [
      "空间动态（管理员）",
      "· 选择发动态类型 / 动态类型",
      "· 发条动态 日常",
      "· 发条动态 心情 下雨了",
      "· 看看草稿 / 确认发动态 / 取消动态",
      "→ 先出草稿，确认后才发（需 NapCat send_qzone_msg）",
    ].join("\n"),
  },
  {
    id: "persona",
    aliases: ["人设", "性格", "预设", "persona"],
    guide: [
      "人设（管理员）",
      "· /人设列表 或 性格",
      "· /人设 御姐宠",
      "· /人设重载",
      "→ 下一句起换口吻",
    ].join("\n"),
  },
  {
    id: "voice",
    aliases: ["配音", "语音", "tts", "voice"],
    guide: [
      "配音（管理员切音色；需 pnpm tts）",
      "· /配音 或 配音列表",
      "· /配音 可莉",
      "用户侧：说「用语音回复」才念（replyMode=ask）",
      "也可：说一句xxx 直接试听",
    ].join("\n"),
  },
];

/**
 * Detect owner private howto asks, e.g.
 * 教程 眼睛 / 怎么用知识库 / 发一下自主的用法 / 悄悄话指令
 */
const HOWTO_INTENT_RE =
  /^(?:\/?(?:教程|用法|说明书|指令说明)\s+(.+)$|(?:怎么用|如何用|怎样用|教我|教一下|用法|教程|说明书)\s*(?:一下)?\s*(?:下)?\s*[「『【\[]?(.+?)[」』】\]]?\s*$|(?:把|给我|发我|发一下|提醒我)?\s*(.+?)\s*(?:的)?(?:使用)?(?:教程|用法|说明书|指令)\s*$|(.+?)\s*怎么用\s*$)/u;

export function isOwnerHowtoAsk(text: string): boolean {
  return matchHowtoQuery(text) != null;
}

export function matchHowtoQuery(text: string): string | null {
  const t = text.trim();
  if (!t || t.length > 48) return null;
  // Bare「教程」→ skills overview
  if (/^(?:\/?教程|\/?用法|\/?说明书)\s*$/.test(t)) return "技能";

  const m = t.match(HOWTO_INTENT_RE);
  if (!m) return null;
  const topic = (m[1] || m[2] || m[3] || m[4] || "").trim();
  if (!topic || topic.length > 24) return null;
  // Reject if it still looks like free chat
  if (/[？?！!。；;]/.test(topic) && topic.length > 12) return null;
  return topic;
}

export function findHowtoTopic(query: string): HowtoTopic | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  for (const topic of HOWTO_TOPICS) {
    for (const a of topic.aliases) {
      const al = a.toLowerCase();
      if (q === al || q.includes(al) || al.includes(q)) return topic;
    }
  }
  return null;
}

export type OwnerHowtoResult =
  | { handled: false }
  /** Known topic → send guide. */
  | { handled: true; reply: string }
  /** Howto intent but unknown feature → swallow silently. */
  | { handled: true; silent: true };

/**
 * Only owner QQ (admins[0], fallback constant) in private chat.
 * Unknown feature: handled+silent (do not reply, do not fall through to chat).
 */
export function handleOwnerHowto(opts: {
  userId: string;
  groupId?: string;
  text: string;
  cfg?: AppConfig | null;
}): OwnerHowtoResult {
  if (opts.groupId) return { handled: false };
  if (String(opts.userId) !== resolveOwnerQq(opts.cfg)) return { handled: false };

  const query = matchHowtoQuery(opts.text);
  if (!query) return { handled: false };

  const topic = findHowtoTopic(query);
  if (!topic) return { handled: true, silent: true };

  return { handled: true, reply: topic.guide };
}
