import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { keywordRelevance } from "@dsh-memory-sea/memory-sea";

export interface KnowledgeConfig {
  enabled: boolean;
  dir: string;
  chunkChars: number;
  chunkOverlap: number;
  topK: number;
  injectCharLimit: number;
  minScore: number;
  injectOnChat: boolean;
}

export interface KbDoc {
  id: string;
  title: string;
  sourceName: string;
  kind: "md" | "txt" | "pdf";
  ingestedAt: string;
  charCount: number;
  chunkCount: number;
}

export interface KbChunk {
  id: string;
  docId: string;
  title: string;
  text: string;
  ordinal: number;
}

interface KbIndexFile {
  version: 1;
  docs: KbDoc[];
  chunks: KbChunk[];
}

export interface KbHit {
  chunk: KbChunk;
  score: number;
}

const TEXT_EXTS = new Set([".md", ".markdown", ".txt"]);
const PDF_EXTS = new Set([".pdf"]);

export function defaultKnowledgeConfig(
  partial?: Partial<KnowledgeConfig>,
): KnowledgeConfig {
  return {
    enabled: partial?.enabled ?? true,
    dir: partial?.dir ?? "data/knowledge",
    chunkChars: partial?.chunkChars ?? 450,
    chunkOverlap: partial?.chunkOverlap ?? 60,
    topK: partial?.topK ?? 4,
    injectCharLimit: partial?.injectCharLimit ?? 900,
    minScore: partial?.minScore ?? 0.18,
    injectOnChat: partial?.injectOnChat ?? true,
  };
}

export class KnowledgeBase {
  private docs = new Map<string, KbDoc>();
  private chunks: KbChunk[] = [];
  private readonly root: string;
  private readonly inboxDir: string;
  private readonly docsDir: string;
  private readonly indexPath: string;
  private cfg: KnowledgeConfig;

  constructor(absoluteRoot: string, cfg: KnowledgeConfig) {
    this.cfg = { ...cfg };
    this.root = absoluteRoot;
    this.inboxDir = path.join(absoluteRoot, "inbox");
    this.docsDir = path.join(absoluteRoot, "docs");
    this.indexPath = path.join(absoluteRoot, "index.json");
    mkdirSync(this.inboxDir, { recursive: true });
    mkdirSync(this.docsDir, { recursive: true });
    this.load();
  }

  updateConfig(cfg: KnowledgeConfig): void {
    this.cfg = { ...cfg };
  }

  get config(): KnowledgeConfig {
    return this.cfg;
  }

  listDocs(): KbDoc[] {
    return [...this.docs.values()].sort((a, b) =>
      a.title.localeCompare(b.title, "zh"),
    );
  }

  formatStatus(): string {
    const docs = this.listDocs();
    const lines = [
      `知识库 ${this.cfg.enabled ? "开" : "关"} · 文档 ${docs.length} · 切片 ${this.chunks.length}`,
      `目录：${this.root}`,
      `入库：把 .md / .txt / .pdf 放进 inbox，再发「知识入库」`,
      `命令：知识列表 / 知识搜 关键词 / 知识删 文档名 / 知识重载`,
    ];
    if (docs.length) {
      lines.push("——");
      for (const d of docs.slice(0, 12)) {
        lines.push(`· ${d.title}（${d.kind} · ${d.chunkCount} 片）`);
      }
      if (docs.length > 12) lines.push(`…另有 ${docs.length - 12} 篇`);
    }
    return lines.join("\n");
  }

  formatList(): string {
    const docs = this.listDocs();
    if (!docs.length) {
      return "知识库还是空的。把 md/pdf 丢进 inbox 后发「知识入库」。";
    }
    return docs
      .map(
        (d, i) =>
          `${i + 1}. ${d.title}  [${d.id.slice(0, 8)}]  ${d.kind} · ${d.chunkCount}片 · ${d.charCount}字`,
      )
      .join("\n");
  }

  /**
   * Ingest everything new in inbox/, plus optional explicit paths
   * (absolute, or relative to inbox / repo knowledge root).
   */
  async ingest(paths: string[] = []): Promise<{
    added: string[];
    skipped: string[];
    errors: string[];
  }> {
    const added: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    const targets = new Set<string>();
    if (paths.length === 0) {
      for (const name of readdirSync(this.inboxDir)) {
        const full = path.join(this.inboxDir, name);
        if (!statSync(full).isFile()) continue;
        if (!isSupportedFile(name)) continue;
        targets.add(full);
      }
    } else {
      for (const raw of paths) {
        const resolved = resolveIngestPath(raw, this.inboxDir, this.root);
        if (!resolved) {
          errors.push(`找不到：${raw}`);
          continue;
        }
        targets.add(resolved);
      }
    }

    for (const filePath of targets) {
      try {
        const result = await this.ingestOne(filePath);
        if (result === "added") added.push(path.basename(filePath));
        else skipped.push(path.basename(filePath));
      } catch (err) {
        errors.push(
          `${path.basename(filePath)}：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { added, skipped, errors };
  }

  /** Re-parse every file currently under docs/. */
  async rebuild(): Promise<{ docs: number; chunks: number }> {
    this.docs.clear();
    this.chunks = [];
    const names = existsSync(this.docsDir) ? readdirSync(this.docsDir) : [];
    for (const name of names) {
      const full = path.join(this.docsDir, name);
      if (!statSync(full).isFile() || !isSupportedFile(name)) continue;
      await this.ingestOne(full, { alreadyInDocs: true, force: true });
    }
    this.save();
    return { docs: this.docs.size, chunks: this.chunks.length };
  }

  remove(query: string): { ok: true; title: string } | { ok: false; error: string } {
    const q = query.trim().toLowerCase();
    if (!q) return { ok: false, error: "请写文档名或 id，例如：知识删 新人指南" };

    const doc =
      [...this.docs.values()].find(
        (d) =>
          d.id === query.trim() ||
          d.id.startsWith(q) ||
          d.title.toLowerCase() === q ||
          d.sourceName.toLowerCase() === q ||
          d.title.toLowerCase().includes(q) ||
          d.sourceName.toLowerCase().includes(q),
      ) ?? null;

    if (!doc) return { ok: false, error: `没找到「${query.trim()}」` };

    this.docs.delete(doc.id);
    this.chunks = this.chunks.filter((c) => c.docId !== doc.id);
    const stored = path.join(this.docsDir, doc.sourceName);
    if (existsSync(stored)) {
      try {
        rmSync(stored);
      } catch {
        /* ignore */
      }
    }
    this.save();
    return { ok: true, title: doc.title };
  }

  search(query: string, limit = this.cfg.topK): KbHit[] {
    const q = query.trim();
    if (!q || !this.chunks.length) return [];
    const scored: KbHit[] = [];
    for (const chunk of this.chunks) {
      const score = keywordRelevance(q, `${chunk.title}\n${chunk.text}`);
      if (score < this.cfg.minScore) continue;
      scored.push({ chunk, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(1, limit));
  }

  formatSearch(query: string, limit = this.cfg.topK): string {
    const hits = this.search(query, limit);
    if (!hits.length) {
      return `知识库里没搜到和「${query.trim()}」很贴的片段（阈值 ${this.cfg.minScore}）。`;
    }
    return hits
      .map(
        (h, i) =>
          `${i + 1}. 《${h.chunk.title}》#${h.chunk.ordinal + 1}  score=${h.score.toFixed(2)}\n${clip(h.chunk.text, 220)}`,
      )
      .join("\n\n");
  }

  /** Block for chat inject; empty if disabled / weak query / no hits. */
  formatForInject(query: string): string {
    if (!this.cfg.enabled || !this.cfg.injectOnChat) return "";
    const q = query.trim();
    if (!shouldAttemptRetrieve(q)) return "";
    const hits = this.search(q, this.cfg.topK);
    if (!hits.length) return "";

    const header =
      "【知识库摘录——仅作参考，勿整段背诵；资料没写到的请直说不知道】";
    const parts: string[] = [];
    let used = 0;
    for (const h of hits) {
      const line = `· 《${h.chunk.title}》#${h.chunk.ordinal + 1}：${h.chunk.text.trim()}`;
      if (used + line.length > this.cfg.injectCharLimit && parts.length) break;
      parts.push(clip(line, this.cfg.injectCharLimit - used));
      used += parts[parts.length - 1]!.length;
      if (used >= this.cfg.injectCharLimit) break;
    }
    if (!parts.length) return "";
    return `${header}\n${parts.join("\n")}`;
  }

  private async ingestOne(
    filePath: string,
    opts?: { alreadyInDocs?: boolean; force?: boolean },
  ): Promise<"added" | "skipped"> {
    const base = path.basename(filePath);
    const kind = fileKind(base);
    if (!kind) throw new Error("只支持 .md / .txt / .pdf");

    const text = await readDocumentText(filePath, kind);
    const cleaned = normalizeText(text);
    if (cleaned.length < 8) throw new Error("几乎没有可提取文字（扫描版 PDF 需先转文字）");

    const id = hashId(base + "\0" + cleaned.slice(0, 2000));
    if (!opts?.force && this.docs.has(id)) {
      // Same content already indexed — still move out of inbox if needed
      if (!opts?.alreadyInDocs && path.dirname(filePath) === this.inboxDir) {
        const dest = path.join(this.docsDir, uniqueName(this.docsDir, base));
        if (!existsSync(dest)) renameSync(filePath, dest);
        else rmSync(filePath);
      }
      return "skipped";
    }

    let storedName = base;
    if (!opts?.alreadyInDocs) {
      storedName = uniqueName(this.docsDir, base);
      const dest = path.join(this.docsDir, storedName);
      if (path.dirname(filePath) === this.inboxDir) {
        renameSync(filePath, dest);
      } else {
        copyFileSync(filePath, dest);
      }
    } else {
      storedName = base;
    }

    // Replace prior doc with same source name
    for (const [oldId, doc] of this.docs) {
      if (doc.sourceName === storedName || (opts?.force && doc.sourceName === base)) {
        this.docs.delete(oldId);
        this.chunks = this.chunks.filter((c) => c.docId !== oldId);
      }
    }

    const title = titleFromName(storedName);
    const pieces = chunkText(cleaned, this.cfg.chunkChars, this.cfg.chunkOverlap);
    const doc: KbDoc = {
      id,
      title,
      sourceName: storedName,
      kind,
      ingestedAt: new Date().toISOString(),
      charCount: cleaned.length,
      chunkCount: pieces.length,
    };
    this.docs.set(id, doc);
    pieces.forEach((piece, ordinal) => {
      this.chunks.push({
        id: `${id}:${ordinal}`,
        docId: id,
        title,
        text: piece,
        ordinal,
      });
    });
    this.save();
    return "added";
  }

  private load(): void {
    if (!existsSync(this.indexPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.indexPath, "utf8")) as KbIndexFile;
      if (raw.version !== 1 || !Array.isArray(raw.docs) || !Array.isArray(raw.chunks)) {
        return;
      }
      this.docs.clear();
      for (const d of raw.docs) this.docs.set(d.id, d);
      this.chunks = raw.chunks.filter((c) => this.docs.has(c.docId));
    } catch {
      this.docs.clear();
      this.chunks = [];
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.indexPath), { recursive: true });
    const payload: KbIndexFile = {
      version: 1,
      docs: [...this.docs.values()],
      chunks: this.chunks,
    };
    writeFileSync(this.indexPath, JSON.stringify(payload, null, 2), "utf8");
  }
}

export function shouldAttemptRetrieve(query: string): boolean {
  const t = query.trim();
  if (t.length < 2) return false;
  // Skip pure greetings / very short ack
  if (/^(你好|您好|嗨|哈喽|在吗|早|晚安|嗯+|好的?|谢谢|收到)[！!。.~～]*$/u.test(t)) {
    return false;
  }
  return true;
}

export function isSupportedFile(name: string): boolean {
  return fileKind(name) != null;
}

function fileKind(name: string): "md" | "txt" | "pdf" | null {
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXTS.has(ext)) return ext === ".txt" ? "txt" : "md";
  if (PDF_EXTS.has(ext)) return "pdf";
  return null;
}

function resolveIngestPath(
  raw: string,
  inboxDir: string,
  knowledgeRoot: string,
): string | null {
  const trimmed = raw.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return null;
  const candidates = [
    path.isAbsolute(trimmed) ? trimmed : "",
    path.join(inboxDir, trimmed),
    path.join(knowledgeRoot, trimmed),
    path.join(knowledgeRoot, "docs", trimmed),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function titleFromName(name: string): string {
  return name.replace(/\.(md|markdown|txt|pdf)$/i, "").trim() || name;
}

function uniqueName(dir: string, base: string): string {
  if (!existsSync(path.join(dir, base))) return base;
  const ext = path.extname(base);
  const stem = path.basename(base, ext);
  for (let i = 2; i < 1000; i++) {
    const cand = `${stem}-${i}${ext}`;
    if (!existsSync(path.join(dir, cand))) return cand;
  }
  return `${stem}-${Date.now()}${ext}`;
}

function hashId(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 16);
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** Prefer markdown heading boundaries; else sliding window. */
export function chunkText(
  text: string,
  chunkChars: number,
  overlap: number,
): string[] {
  const size = Math.max(120, chunkChars);
  const ov = Math.max(0, Math.min(overlap, Math.floor(size / 3)));
  const byHeading = splitMarkdownSections(text);
  const out: string[] = [];

  for (const section of byHeading) {
    if (section.length <= size) {
      if (section.trim()) out.push(section.trim());
      continue;
    }
    let start = 0;
    while (start < section.length) {
      let end = Math.min(section.length, start + size);
      if (end < section.length) {
        const soft = section.lastIndexOf("\n", end);
        if (soft > start + Math.floor(size * 0.5)) end = soft;
      }
      const piece = section.slice(start, end).trim();
      if (piece) out.push(piece);
      if (end >= section.length) break;
      start = Math.max(end - ov, start + 1);
    }
  }
  return out.length ? out : text.trim() ? [text.trim()] : [];
}

function splitMarkdownSections(text: string): string[] {
  const lines = text.split("\n");
  const sections: string[] = [];
  let buf: string[] = [];
  for (const line of lines) {
    if (/^#{1,3}\s+\S/.test(line) && buf.length) {
      sections.push(buf.join("\n").trim());
      buf = [line];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) sections.push(buf.join("\n").trim());
  return sections.filter(Boolean);
}

async function readDocumentText(
  filePath: string,
  kind: "md" | "txt" | "pdf",
): Promise<string> {
  if (kind === "md" || kind === "txt") {
    return readFileSync(filePath, "utf8");
  }
  return extractPdfText(filePath);
}

async function extractPdfText(filePath: string): Promise<string> {
  const buf = readFileSync(filePath);
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const result = await parser.getText();
      const text = String(result.text ?? "").trim();
      if (text) return text;
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } catch (err) {
    const fallback = crudePdfText(buf);
    if (fallback.trim().length >= 8) return fallback;
    throw err instanceof Error
      ? err
      : new Error(`PDF 解析失败：${String(err)}`);
  }
  const fallback = crudePdfText(buf);
  if (fallback.trim().length >= 8) return fallback;
  throw new Error("PDF 无文本层（可能是纯扫描图）");
}

/** Last-resort: pull printable literal strings from PDF bytes. */
function crudePdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const chunks: string[] = [];
  const re = /\((?:\\.|[^\\)]){2,200}\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const inner = m[0].slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, " ")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\");
    if (/[\u4e00-\u9fffA-Za-z]{2,}/.test(inner)) chunks.push(inner);
  }
  return chunks.join("\n");
}
