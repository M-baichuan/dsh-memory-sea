import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { EyeVault } from "./eye-vault.js";

describe("EyeVault", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("encrypts round-trip and rejects wrong secret", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "eye-vault-"));
    dirs.push(dir);
    const vault = new EyeVault(dir, 5);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, ...Buffer.alloc(64, 7)]);
    const meta = vault.add("correct-secret", { jpeg, note: "测试" });
    expect(meta.id).toBeTruthy();

    const got = vault.getJpeg("correct-secret", meta.id);
    expect(got.jpeg.equals(jpeg)).toBe(true);

    expect(() => vault.list("wrong-secret")).toThrow();
  });
});
