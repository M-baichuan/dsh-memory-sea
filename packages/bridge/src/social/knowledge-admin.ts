import type { AppConfig } from "@dsh-memory-sea/shared";
import type { KnowledgeBase } from "./knowledge-base.js";

const STATUS_RE = /^(?:\/?知识库|\/?知识帮助)\s*$/;
const LIST_RE = /^(?:\/?知识列表)\s*$/;
const INGEST_RE = /^(?:\/?知识入库|\/?入库)(?:\s+(.+))?$/;
const SEARCH_RE = /^(?:\/?知识搜|\/?搜知识)\s+(.+)$/;
const DEL_RE = /^(?:\/?知识删|\/?删知识)\s+(.+)$/;
const RELOAD_RE = /^(?:\/?知识重载)\s*$/;

export function isKnowledgeCommand(text: string): boolean {
  const t = text.trim();
  return (
    STATUS_RE.test(t) ||
    LIST_RE.test(t) ||
    INGEST_RE.test(t) ||
    SEARCH_RE.test(t) ||
    DEL_RE.test(t) ||
    RELOAD_RE.test(t)
  );
}

/**
 * QQ commands for lightweight knowledge base.
 * Mutating ops (入库 / 删 / 重载) are admin-only.
 * 知识库 / 知识列表 / 知识搜 are open to allowed users.
 */
export async function handleKnowledgeAdmin(opts: {
  cfg: AppConfig;
  userId: string;
  text: string;
  kb: KnowledgeBase;
}): Promise<{ handled: true; reply: string } | { handled: false }> {
  const text = opts.text.trim();
  if (!isKnowledgeCommand(text)) return { handled: false };

  if (
    opts.cfg.social.knowledge?.enabled === false ||
    opts.cfg.social.skills?.knowledge === false
  ) {
    return {
      handled: true,
      reply: "知识库已关闭（config social.knowledge / skills.knowledge）。",
    };
  }

  const isAdmin = opts.cfg.access.admins.includes(opts.userId);

  if (STATUS_RE.test(text)) {
    return { handled: true, reply: opts.kb.formatStatus() };
  }

  if (LIST_RE.test(text)) {
    return { handled: true, reply: opts.kb.formatList() };
  }

  const search = text.match(SEARCH_RE);
  if (search?.[1]) {
    return { handled: true, reply: opts.kb.formatSearch(search[1].trim()) };
  }

  if (INGEST_RE.test(text) || DEL_RE.test(text) || RELOAD_RE.test(text)) {
    if (!isAdmin) {
      return { handled: true, reply: "入库 / 删除 / 重载只有管理员能做。" };
    }
  }

  if (RELOAD_RE.test(text)) {
    const r = await opts.kb.rebuild();
    return {
      handled: true,
      reply: `知识库已重载：${r.docs} 篇文档 · ${r.chunks} 个切片。下一句起按新索引检索。`,
    };
  }

  const del = text.match(DEL_RE);
  if (del?.[1]) {
    const r = opts.kb.remove(del[1]);
    if (!r.ok) return { handled: true, reply: r.error };
    return { handled: true, reply: `已从知识库移除「${r.title}」。` };
  }

  const ingest = text.match(INGEST_RE);
  if (ingest) {
    const arg = ingest[1]?.trim();
    const paths = arg ? [arg] : [];
    const r = await opts.kb.ingest(paths);
    const lines: string[] = [];
    if (r.added.length) lines.push(`已入库：${r.added.join("、")}`);
    if (r.skipped.length) lines.push(`已存在跳过：${r.skipped.join("、")}`);
    if (r.errors.length) lines.push(`失败：\n- ${r.errors.join("\n- ")}`);
    if (!lines.length) {
      lines.push(
        "inbox 里没有新的 .md / .txt / .pdf。\n" +
          "把文件放到 data/knowledge/inbox 后再发「知识入库」，\n" +
          "或：知识入库 某个文件名.md",
      );
    }
    return { handled: true, reply: lines.join("\n") };
  }

  return { handled: false };
}
