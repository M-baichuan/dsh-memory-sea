import { describe, expect, it } from "vitest";
import {
  splitBubbles,
  typingDelayMs,
} from "../../packages/bridge/src/pipeline/bubbles.js";
import { isPokeAtSelf } from "../../packages/bridge/src/pipeline/poke.js";
import { pickProactivePrompt } from "../../packages/bridge/src/social/presence-loop.js";
import { PersonaCardStore } from "../../packages/bridge/src/social/persona-cards.js";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

describe("splitBubbles", () => {
  it("splits on |||", () => {
    expect(splitBubbles("嗨|||在吗", true)).toEqual(["嗨", "在吗"]);
  });

  it("splits blank lines when few paragraphs", () => {
    expect(splitBubbles("一\n\n二\n\n三", true)).toEqual(["一", "二", "三"]);
  });

  it("keeps single when disabled", () => {
    expect(splitBubbles("a|||b", false)).toEqual(["a|||b"]);
  });
});

describe("typingDelayMs", () => {
  it("clamps", () => {
    const t = {
      multiBubble: true,
      bubbleGapMinMs: 800,
      bubbleGapMaxMs: 2000,
      typingDelay: true,
      typingMsPerChar: 30,
      typingMinMs: 400,
      typingMaxMs: 2500,
    };
    expect(typingDelayMs("hi", t)).toBe(400);
    expect(typingDelayMs("x".repeat(200), t)).toBe(2500);
  });
});

describe("poke detect", () => {
  it("detects notify poke at self", () => {
    expect(
      isPokeAtSelf(
        { post_type: "notice", notice_type: "notify", sub_type: "poke", target_id: "1" },
        "1",
      ),
    ).toBe(true);
    expect(
      isPokeAtSelf(
        { post_type: "notice", notice_type: "notify", sub_type: "poke", target_id: "2" },
        "1",
      ),
    ).toBe(false);
  });
});

describe("probe pool", () => {
  it("rotates prompts", () => {
    const social = {
      proactivePrompt: "A",
      proactivePromptPool: ["P1", "P2"],
    } as never;
    expect(pickProactivePrompt(social)).toBe("P1");
    expect(pickProactivePrompt(social)).toBe("P2");
    expect(pickProactivePrompt(social)).toBe("P1");
  });
});

describe("persona cards", () => {
  it("learns call-me and formats inject", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cards-"));
    const store = new PersonaCardStore(path.join(dir, "cards.json"));
    store.learnFromUtterance("u1", "叫我小明", "Nick");
    expect(store.formatForInject("u1")).toContain("小明");
    rmSync(dir, { recursive: true, force: true });
  });
});
