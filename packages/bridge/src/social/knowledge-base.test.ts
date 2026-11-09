import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  chunkText,
  defaultKnowledgeConfig,
  KnowledgeBase,
  shouldAttemptRetrieve,
} from "./knowledge-base.js";

describe("chunkText", () => {
  it("splits on markdown headings", () => {
    const text = "# A\nhello world\n\n# B\nsecond section here";
    const parts = chunkText(text, 450, 40);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts[0]).toContain("A");
    expect(parts.some((p) => p.includes("second"))).toBe(true);
  });

  it("windows long sections", () => {
    const text = "字".repeat(1000);
    const parts = chunkText(text, 200, 40);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.every((p) => p.length <= 220)).toBe(true);
  });
});

describe("shouldAttemptRetrieve", () => {
  it("skips greetings", () => {
    expect(shouldAttemptRetrieve("你好")).toBe(false);
    expect(shouldAttemptRetrieve("嗯")).toBe(false);
  });
  it("allows real questions", () => {
    expect(shouldAttemptRetrieve("新人怎么申请加入项目")).toBe(true);
  });
});

describe("KnowledgeBase", () => {
  it("ingests md from inbox and retrieves", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "kb-"));
    const kb = new KnowledgeBase(root, defaultKnowledgeConfig());
    mkdirSync(path.join(root, "inbox"), { recursive: true });
    writeFileSync(
      path.join(root, "inbox", "新人指南.md"),
      [
        "# 加入流程",
        "新人申请加入项目需要先填写登记表，再等待管理员审核。",
        "",
        "# 反馈渠道",
        "问题请发到社群反馈频道，不要私信客服。",
      ].join("\n"),
      "utf8",
    );

    const r = await kb.ingest();
    expect(r.added).toContain("新人指南.md");
    expect(kb.listDocs().length).toBe(1);

    const hits = kb.search("申请加入项目");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.chunk.text).toMatch(/登记表|审核/);

    const inject = kb.formatForInject("新人怎么申请加入");
    expect(inject).toContain("知识库摘录");
    expect(inject).toContain("新人指南");

    const removed = kb.remove("新人指南");
    expect(removed.ok).toBe(true);
    expect(kb.listDocs().length).toBe(0);
  });

  it("ingests explicit path", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "kb2-"));
    const kb = new KnowledgeBase(root, defaultKnowledgeConfig());
    const file = path.join(root, "notes.txt");
    writeFileSync(file, "防火墙端口默认开放 8787 用于 TTS。", "utf8");
    const r = await kb.ingest([file]);
    expect(r.added.length).toBe(1);
    expect(kb.formatSearch("TTS 端口")).toMatch(/8787/);
  });
});
