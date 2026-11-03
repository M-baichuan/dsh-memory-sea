import { describe, expect, it } from "vitest";
import {
  mintBrowserSessionCookie,
  isLoopbackBase,
} from "../../packages/bridge/src/dsh/cookie.js";
import { createHash, createHmac, randomBytes } from "node:crypto";

describe("desktop host cookie mint", () => {
  it("mints cookie bound to authority", () => {
    const secret = randomBytes(32);
    const cookie = mintBrowserSessionCookie("http://127.0.0.1:57913", secret);
    expect(cookie.startsWith("dsh-auth-")).toBe(true);
    expect(cookie.includes("=")).toBe(true);
    const [name, value] = cookie.split("=");
    const expectedName =
      "dsh-auth-" +
      createHash("sha256")
        .update("127.0.0.1:57913")
        .digest("base64")
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
    expect(name).toBe(expectedName);
    const parts = value!.split(".");
    expect(parts[0]).toBe("v1");
    expect(parts).toHaveLength(3);
    const body = parts[1]!;
    const sig = parts[2]!;
    const expectSig = createHmac("sha256", secret)
      .update(body)
      .digest("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
    expect(sig).toBe(expectSig);
  });

  it("detects loopback bases", () => {
    expect(isLoopbackBase("http://127.0.0.1:57913")).toBe(true);
    expect(isLoopbackBase("http://localhost:3080")).toBe(true);
    expect(isLoopbackBase("http://example.com:3080")).toBe(false);
  });
});
