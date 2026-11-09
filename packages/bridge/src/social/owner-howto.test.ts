import { describe, expect, it } from "vitest";
import {
  findHowtoTopic,
  handleOwnerHowto,
  matchHowtoQuery,
} from "./owner-howto.js";
import { EYE_OWNER_QQ } from "./eye.js";

describe("matchHowtoQuery", () => {
  it("parses common asks", () => {
    expect(matchHowtoQuery("教程 眼睛")).toBe("眼睛");
    expect(matchHowtoQuery("怎么用知识库")).toBe("知识库");
    expect(matchHowtoQuery("自主的用法")).toBe("自主");
    expect(matchHowtoQuery("发一下悄悄话教程")).toBe("悄悄话");
    expect(matchHowtoQuery("配音怎么用")).toBe("配音");
    expect(matchHowtoQuery("教程")).toBe("技能");
  });

  it("ignores ordinary chat", () => {
    expect(matchHowtoQuery("今天眼睛好酸")).toBeNull();
    expect(matchHowtoQuery("你好")).toBeNull();
  });
});

describe("findHowtoTopic", () => {
  it("resolves aliases", () => {
    expect(findHowtoTopic("看看外面")?.id).toBe("eye");
    expect(findHowtoTopic("说说")?.id).toBe("qzone");
  });
  it("unknown → null", () => {
    expect(findHowtoTopic("飞天遁地")).toBeNull();
  });
});

describe("handleOwnerHowto", () => {
  it("only owner private", () => {
    expect(
      handleOwnerHowto({
        userId: EYE_OWNER_QQ,
        groupId: "1",
        text: "教程 眼睛",
      }).handled,
    ).toBe(false);
    expect(
      handleOwnerHowto({
        userId: "999",
        text: "教程 眼睛",
      }).handled,
    ).toBe(false);
  });

  it("replies known and silences unknown", () => {
    const ok = handleOwnerHowto({
      userId: EYE_OWNER_QQ,
      text: "怎么用 眼睛",
    });
    expect(ok.handled).toBe(true);
    expect("reply" in ok && ok.reply).toMatch(/看看外面/);

    const miss = handleOwnerHowto({
      userId: EYE_OWNER_QQ,
      text: "教程 飞天遁地",
    });
    expect(miss).toEqual({ handled: true, silent: true });
  });
});
