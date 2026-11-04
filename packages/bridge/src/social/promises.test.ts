import { describe, expect, it } from "vitest";
import { parsePromiseDue } from "./promises.js";

describe("parsePromiseDue", () => {
  const now = new Date("2026-11-03T12:00:00+08:00"); // Tuesday

  it("parses minutes later", () => {
    const r = parsePromiseDue("30分钟后 喝水", now);
    expect(r?.text).toBe("喝水");
    expect(r!.dueAt.getTime()).toBe(now.getTime() + 30 * 60_000);
  });

  it("parses tomorrow with hour", () => {
    const r = parsePromiseDue("明天20:00 交材料", now);
    expect(r?.text).toBe("交材料");
    expect(r!.dueAt.getHours()).toBe(20);
    expect(r!.dueAt.getDate()).toBe(4);
  });

  it("parses 今天 20:00", () => {
    const r = parsePromiseDue("今天 20:00 交材料", now);
    expect(r?.text).toBe("交材料");
    expect(r!.dueAt.getDate()).toBe(3);
    expect(r!.dueAt.getHours()).toBe(20);
    expect(r!.dueAt.getMinutes()).toBe(0);
  });

  it("parses bare clock as today when still ahead", () => {
    const r = parsePromiseDue("20:00 喝水", now);
    expect(r?.text).toBe("喝水");
    expect(r!.dueAt.getDate()).toBe(3);
    expect(r!.dueAt.getHours()).toBe(20);
  });

  it("rolls bare clock to tomorrow when already past", () => {
    const evening = new Date("2026-11-03T21:00:00+08:00");
    const r = parsePromiseDue("20:00 喝水", evening);
    expect(r!.dueAt.getDate()).toBe(4);
    expect(r!.dueAt.getHours()).toBe(20);
  });

  it("keeps 周五 today when clock still ahead", () => {
    // 2026-11-06 is Friday
    const friNoon = new Date("2026-11-06T12:00:00+08:00");
    const r = parsePromiseDue("周五 18:00 打电话", friNoon);
    expect(r?.text).toBe("打电话");
    expect(r!.dueAt.getDate()).toBe(6);
    expect(r!.dueAt.getHours()).toBe(18);
  });

  it("pushes 周五 to next week when today's clock already past", () => {
    const friNight = new Date("2026-11-06T19:00:00+08:00");
    const r = parsePromiseDue("周五 18:00 打电话", friNight);
    expect(r!.dueAt.getDate()).toBe(13);
    expect(r!.dueAt.getHours()).toBe(18);
  });

  it("defaults to one hour when no time", () => {
    const r = parsePromiseDue("起身活动", now);
    expect(r?.text).toBe("起身活动");
    expect(r!.dueAt.getTime()).toBe(now.getTime() + 60 * 60_000);
  });
});
