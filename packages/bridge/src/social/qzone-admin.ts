import type { AppConfig } from "@dsh-memory-sea/shared";
import type { MemorySea } from "@dsh-memory-sea/memory-sea";
import type { DshApiClient } from "../dsh/api-client.js";
import { qqSessionKey, type SessionStore } from "../dsh/sessions.js";
import type { OneBotClient } from "../onebot/client.js";
import { sendQzoneMsg } from "../onebot/qzone.js";
import { parseStickerTags } from "./stickers.js";
import type { QzoneDraftStore } from "./qzone-draft.js";
import { rememberQzonePublish } from "./qzone-memory.js";
import {
  formatQzoneTypesMenu,
  resolveQzonePostType,
  splitTypeAndHint,
  type QzonePostType,
} from "./qzone-types.js";

/** Avoid swallowing「/动态类型 …」— that has its own handlers. */
const DRAFT_RE = /^(?:\/?动态(?!类型)|发条动态|发个动态|发说说)\s*(.*)$/s;
const TYPE_LIST_RE = /^(?:\/?动态类型|选择发动态类型|选择发动态的类型|发动态类型)\s*$/;
const TYPE_PICK_RE =
  /^(?:\/?动态类型|选择发动态类型|选择发动态的类型|发动态类型)\s+(\S+)(?:\s+(.*))?$/s;
const CONFIRM_RE = /^(?:确认发动态|确认发布|发布动态|发了吧|就发这个)\s*$/;
const CANCEL_RE = /^(?:取消动态|取消发布|不要发了)\s*$/;
const PEEK_RE = /^(?:看看草稿|动态草稿|草稿)\s*$/;

export function isQzoneAdminCommand(text: string): boolean {
  const t = text.trim();
  return (
    DRAFT_RE.test(t) ||
    TYPE_LIST_RE.test(t) ||
    TYPE_PICK_RE.test(t) ||
    CONFIRM_RE.test(t) ||
    CANCEL_RE.test(t) ||
    PEEK_RE.test(t)
  );
}

function scrubDraftText(raw: string): string {
  const { text } = parseStickerTags(raw);
  return text
    .replace(/【人设·勿复述】[\s\S]*?(?=\n\n|$)/g, "")
    .replace(/^（DSH[^）]*）/gm, "")
    .trim()
    .slice(0, 200);
}

function ugcLabel(code: number): string {
  if (code === 1) return "所有人";
  if (code === 4) return "好友";
  if (code === 64) return "仅自己";
  return String(code);
}

/**
 * Admin-only QZone flow:
 * 1) 选择发动态类型 → 看菜单
 * 2) /动态类型 心情 | 发条动态 日常 [主题] → 生成草稿
 * 3) 确认发动态 → 真发
 * 4) 取消动态 → 丢弃草稿
 */
export async function handleQzoneAdmin(opts: {
  cfg: AppConfig;
  userId: string;
  text: string;
  client: OneBotClient;
  dsh: DshApiClient;
  sessions: SessionStore;
  systemPrompt: string;
  drafts: QzoneDraftStore;
  sea?: MemorySea;
}): Promise<{ handled: true; reply: string } | { handled: false }> {
  const text = opts.text.trim();
  if (!isQzoneAdminCommand(text)) return { handled: false };

  const qzone = opts.cfg.social.qzone;
  if (!qzone?.enabled) {
    return {
      handled: true,
      reply: "空间动态功能未开启。在 config.json 设 social.qzone.enabled=true 后重启 bridge。",
    };
  }

  if (!opts.cfg.access.admins.includes(opts.userId)) {
    return { handled: true, reply: "只有管理员可以发空间动态。" };
  }

  if (TYPE_LIST_RE.test(text)) {
    const draft = opts.drafts.get(opts.userId);
    return { handled: true, reply: formatQzoneTypesMenu(draft?.typeId) };
  }

  if (PEEK_RE.test(text)) {
    const draft = opts.drafts.get(opts.userId);
    if (!draft) return { handled: true, reply: "当前没有待发草稿。发「发条动态」或「/动态类型 心情」生成一条。" };
    const typeLine = draft.typeId ? `类型：${draft.typeId}\n` : "";
    return {
      handled: true,
      reply:
        `待发草稿（${draft.createdAt}）\n${typeLine}———\n${draft.content}\n———\n` +
        `确认发动态 / 取消动态 / 选择发动态类型`,
    };
  }

  if (CANCEL_RE.test(text)) {
    if (!opts.drafts.get(opts.userId)) return { handled: true, reply: "没有草稿可取消。" };
    opts.drafts.clear(opts.userId);
    return { handled: true, reply: "已取消，草稿清掉了。" };
  }

  if (CONFIRM_RE.test(text)) {
    const draft = opts.drafts.get(opts.userId);
    if (!draft) {
      return { handled: true, reply: "没有待发草稿。先「/动态类型 心情」或「发条动态」生成。" };
    }
    const result = await sendQzoneMsg(opts.client, {
      content: draft.content,
      ugcRight: qzone.ugcRight,
    });
    if (!result.ok) {
      return {
        handled: true,
        reply:
          `发布失败：${result.error}\n` +
          `请确认协议端是 NapCat 且支持 send_qzone_msg；草稿仍保留，可改完再「确认发动态」。`,
      };
    }
    opts.drafts.clear(opts.userId);
    if (opts.sea) {
      rememberQzonePublish(opts.sea, opts.cfg, {
        adminId: opts.userId,
        typeId: draft.typeId,
        content: draft.content,
      });
    }
    const typeBit = draft.typeId ? `类型「${draft.typeId}」·` : "";
    return {
      handled: true,
      reply: `已发到 QQ 空间。${typeBit}可见=${ugcLabel(qzone.ugcRight)}${result.tid ? ` · tid=${result.tid}` : ""}`,
    };
  }

  const typePick = text.match(TYPE_PICK_RE);
  if (typePick?.[1]) {
    const type = resolveQzonePostType(typePick[1]);
    if (!type) {
      return {
        handled: true,
        reply: `没有这个类型「${typePick[1]}」。\n\n${formatQzoneTypesMenu()}`,
      };
    }
    const hint = String(typePick[2] ?? "").trim();
    return createDraftReply(opts, type, hint);
  }

  const m = text.match(DRAFT_RE);
  if (!m) return { handled: false };
  const { type, hint } = splitTypeAndHint(String(m[1] ?? ""));
  return createDraftReply(opts, type, hint);
}

async function createDraftReply(
  opts: {
    userId: string;
    dsh: DshApiClient;
    sessions: SessionStore;
    systemPrompt: string;
    drafts: QzoneDraftStore;
  },
  type: QzonePostType | null,
  hint: string,
): Promise<{ handled: true; reply: string }> {
  try {
    const content = await generateQzoneDraft({
      dsh: opts.dsh,
      sessions: opts.sessions,
      systemPrompt: opts.systemPrompt,
      type,
      hint,
    });
    if (!content) {
      return { handled: true, reply: "草稿生成失败（空内容），再试一次。" };
    }
    opts.drafts.set({
      content,
      typeId: type?.id,
      hint: hint || undefined,
      createdBy: opts.userId,
      createdAt: new Date().toISOString(),
    });
    const typeLine = type ? `类型：${type.id}（${type.blurb}）\n` : "类型：未指定（随想风）\n";
    return {
      handled: true,
      reply:
        `动态草稿（未发布）\n${typeLine}———\n${content}\n———\n` +
        `确认发动态 → 真的发到空间\n取消动态 → 丢掉\n` +
        `换类型：选择发动态类型 / /动态类型 想念`,
    };
  } catch (err) {
    return {
      handled: true,
      reply: `草稿生成失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function generateQzoneDraft(opts: {
  dsh: DshApiClient;
  sessions: SessionStore;
  systemPrompt: string;
  type: QzonePostType | null;
  hint: string;
}): Promise<string> {
  const qqKey = qqSessionKey({ userId: "qzone", groupId: undefined });
  let mapping = opts.sessions.get(qqKey);
  if (!mapping) {
    const sessionId = await opts.dsh.ensureSession({
      key: qqKey,
      title: "QQ 空间草稿",
      systemPrompt: opts.systemPrompt,
    });
    mapping = {
      qqKey,
      sessionId,
      title: "QQ 空间草稿",
      updatedAt: new Date().toISOString(),
    };
    opts.sessions.set(mapping);
  }

  const typeLine = opts.type
    ? `动态类型：${opts.type.id}。${opts.type.promptHint}`
    : "动态类型：随想。主题自定，像随手发的生活感即可。";
  const topic = opts.hint ? `额外主题/要求：${opts.hint}` : "无额外主题。";

  const message =
    `【系统·空间草稿】请写 1～3 句适合发在 QQ 空间的短动态。\n` +
    `${typeLine}\n` +
    `${topic}\n` +
    `要求：口语、符合当前人设；不要标题、不要列表、不要解释、不要 [[sticker]] / [[voice]]、不要说自己是 AI。\n` +
    `只输出动态正文。`;

  const result = await opts.dsh.prompt({
    sessionId: mapping.sessionId,
    message,
    systemPrompt: opts.systemPrompt,
  });
  mapping.updatedAt = new Date().toISOString();
  opts.sessions.set(mapping);
  return scrubDraftText(result.text || "");
}
