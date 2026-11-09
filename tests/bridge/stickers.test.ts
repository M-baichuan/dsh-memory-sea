import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveStickerEntries } from "../../packages/bridge/src/pipeline/egress.js";
import {
  findSticker,
  listStickers,
  parseStickerTags,
  stickerHintForPrompt,
} from "../../packages/bridge/src/social/stickers.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("parseStickerTags", () => {
  it("strips sticker tags and collects ids", () => {
    const parsed = parseStickerTags("嗨[[sticker:开心]]呀 [[表情:委屈]]");
    expect(parsed.text).toBe("嗨呀");
    expect(parsed.stickerIds).toEqual(["开心", "委屈"]);
    expect(parsed.searchQueries).toEqual([]);
    expect(parsed.voiceLines).toEqual([]);
  });

  it("collects search-face tags", () => {
    const a = parseStickerTags("嗯[[搜表情:无语]]");
    expect(a.text).toBe("嗯");
    expect(a.searchQueries).toEqual(["无语"]);
    const b = parseStickerTags("[[sticker:搜:再见]]");
    expect(b.searchQueries).toEqual(["再见"]);
  });

  it("collects voice tags", () => {
    const parsed = parseStickerTags("听[[voice:晚安]]");
    expect(parsed.text).toBe("听");
    expect(parsed.voiceLines).toEqual(["晚安"]);
  });

  it("returns empty stickers when none", () => {
    expect(parseStickerTags("纯文字")).toEqual({
      text: "纯文字",
      stickerIds: [],
      searchQueries: [],
      voiceLines: [],
    });
  });
});

describe("listStickers / findSticker", () => {
  it("indexes image basenames as ids", () => {
    const dir = path.join(os.tmpdir(), `stickers-${Date.now()}`);
    tmpDirs.push(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "开心.png"), "x");
    writeFileSync(path.join(dir, "note.txt"), "nope");
    const entries = listStickers(dir);
    expect(entries.map((e) => e.id)).toEqual(["开心"]);
    expect(findSticker(entries, "开心")?.id).toBe("开心");
    expect(findSticker(entries, "missing")).toBeUndefined();
  });
});

describe("stickerHintForPrompt", () => {
  it("lists ids and encourages occasional use", () => {
    const hint = stickerHintForPrompt(
      [
        { id: "开心", filePath: "/x/开心.png" },
        { id: "委屈", filePath: "/x/委屈.png" },
      ],
      false,
    );
    expect(hint).toContain("开心");
    expect(hint).toContain("委屈");
    expect(hint).toMatch(/适当插一张|插一张/);
  });
});

describe("resolveStickerEntries", () => {
  it("fuzzy-matches mood words", () => {
    const entries = [
      { id: "开心", filePath: "/x/开心.png" },
      { id: "无语", filePath: "/x/无语.png" },
    ];
    expect(resolveStickerEntries(entries, ["开开心心"]).map((e) => e.id)).toEqual([
      "开心",
    ]);
    expect(resolveStickerEntries(entries, ["missing"]).length).toBe(0);
  });
});
