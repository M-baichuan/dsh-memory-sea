import { describe, expect, it } from "vitest";
import { isPersonaAdminCommand } from "./persona-admin.js";

describe("isPersonaAdminCommand", () => {
  it("matches list / switch / reload forms", () => {
    expect(isPersonaAdminCommand("/性格")).toBe(true);
    expect(isPersonaAdminCommand("性格")).toBe(true);
    expect(isPersonaAdminCommand("/人设")).toBe(true);
    expect(isPersonaAdminCommand("/人设列表")).toBe(true);
    expect(isPersonaAdminCommand("/人设 冷御")).toBe(true);
    expect(isPersonaAdminCommand("人设 软萌")).toBe(true);
    expect(isPersonaAdminCommand("/人设重载")).toBe(true);
    expect(isPersonaAdminCommand("人设重载")).toBe(true);
  });

  it("ignores normal chat", () => {
    expect(isPersonaAdminCommand("你好")).toBe(false);
    expect(isPersonaAdminCommand("人设不错")).toBe(false);
    expect(isPersonaAdminCommand("/收藏 开心")).toBe(false);
  });
});
