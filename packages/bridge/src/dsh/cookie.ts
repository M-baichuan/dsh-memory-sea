import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const BROWSER_SESSION_KEY = "client-connection/browser-session";
const COOKIE_PAYLOAD_VERSION = 1;
const COOKIE_PREFIX = "dsh-auth-";
const SECRET_BYTES = 32;
export const MINTED_COOKIE_LIFETIME_MS = 60 * 60 * 1000;

function resolveDshHome(): string {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

function base64url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/**
 * Read DSH persistent browser-session HMAC secret from ~/.dsh/.credentials.yaml
 * (same mechanism as qq-bridge; no launch-token / no manual cookie paste required).
 */
export function readBrowserSessionSecret(): Buffer | null {
  try {
    const text = readFileSync(path.join(resolveDshHome(), ".credentials.yaml"), "utf8");
    const keyIdx = text.indexOf(BROWSER_SESSION_KEY);
    if (keyIdx < 0) return null;
    const slice = text.slice(keyIdx, keyIdx + 800);
    if (!/kind:\s*grant/.test(slice)) return null;
    if (!/version:\s*1\b/.test(slice)) return null;
    const secretMatch = slice.match(/secret:\s*["']?([A-Za-z0-9_-]+)["']?/);
    if (!secretMatch?.[1]) return null;
    const decoded = Buffer.from(
      secretMatch[1].replaceAll("-", "+").replaceAll("_", "/"),
      "base64",
    );
    return decoded.byteLength === SECRET_BYTES ? decoded : null;
  } catch {
    return null;
  }
}

export function mintBrowserSessionCookie(
  baseUrl: string,
  secret: Buffer,
  lifetimeMs = MINTED_COOKIE_LIFETIME_MS,
): string {
  const authority = new URL(String(baseUrl)).host;
  if (!authority) throw new Error("DSH baseUrl has no authority");
  const issuedAt = Date.now();
  const expiresAt = issuedAt + lifetimeMs;
  const body = base64url(
    Buffer.from(
      JSON.stringify({
        version: COOKIE_PAYLOAD_VERSION,
        authority,
        issuedAt,
        expiresAt,
      }),
      "utf8",
    ),
  );
  const signature = base64url(createHmac("sha256", secret).update(body).digest());
  const name = COOKIE_PREFIX + base64url(createHash("sha256").update(authority).digest());
  return `${name}=v1.${body}.${signature}`;
}

/** Mint a Cookie header value for Desktop Host auth; empty string if secret missing. */
export function discoverDshSessionCookie(baseUrl: string): string {
  const secret = readBrowserSessionSecret();
  if (!secret) return "";
  try {
    return mintBrowserSessionCookie(baseUrl, secret);
  } catch {
    return "";
  }
}

export function isLoopbackBase(baseUrl: string): boolean {
  try {
    const u = new URL(String(baseUrl));
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost")) return true;
    if (host === "::1" || host === "[::1]") return true;
    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  } catch {
    return false;
  }
}
