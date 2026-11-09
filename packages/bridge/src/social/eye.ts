import type { AppConfig } from "@dsh-memory-sea/shared";
import type { MemorySea } from "@dsh-memory-sea/memory-sea";
import type { DshApiClient } from "../dsh/api-client.js";
import { qqSessionKey, type SessionStore } from "../dsh/sessions.js";
import type { EyeVault } from "./eye-vault.js";
import { stashEyeFrame } from "./eye-vault-admin.js";

/** Exact short commands（外面 / 外边 都认）. */
const EYE_EXACT_RE =
  /^(?:看看外[面边]|看一眼外[面边]|看一眼|睁眼|\/看外面|\/看外边|\/eye)\s*$/;

/**
 * Fallback owner QQ when `access.admins[0]` is empty / invalid.
 * Prefer `resolveOwnerQq(cfg)` everywhere — do not hard-compare this alone.
 */
export const EYE_OWNER_QQ = "10001";

/** Owner QQ: first admin, else hardcoded fallback. */
export function resolveOwnerQq(cfg?: AppConfig | null): string {
  const fromAdmin = String(cfg?.access?.admins?.[0] ?? "").trim();
  if (/^\d{5,12}$/.test(fromAdmin)) return fromAdmin;
  return EYE_OWNER_QQ;
}

/**
 * Exact + natural asks, e.g.「你现在能看看外边不」.
 * Keep short so ordinary chat about weather outside won't steal the camera.
 * Call on text with口令 already stripped.
 */
export function isEyeCommand(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 40) return false;
  if (/(发图|照片|相册|截图给你)/.test(t)) return false;
  if (EYE_EXACT_RE.test(t)) return true;

  const lookOut = /看(?:看|一眼|一下)?外[面边]/.test(t);
  const openEye = /睁开?眼睛?|睁眼看看|用摄像头看看?/.test(t);
  if (!lookOut && !openEye) return false;

  if (/^(?:看|睁)/.test(t)) return true;
  return /(?:可以|能不能|能否|能|要不要|试试|帮我|现在|了不|吗|嘛|吧|一下)/.test(t);
}

export function canUseEye(userId: string, cfg?: AppConfig | null): boolean {
  return String(userId ?? "").trim() === resolveOwnerQq(cfg);
}

export function resolveEyeSecret(cfg: AppConfig): string {
  const fromEnv = String(process.env.EYE_SECRET ?? "").trim();
  if (fromEnv) return fromEnv;
  return String(cfg.social.eye?.secret ?? "").trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Peel trailing口令 from message.
 * Accepts: `看看外面 SECREET` / `看看外面 口令SECRET` / `看看外面 口令：SECRET`
 */
export function peelEyeSecret(
  text: string,
  secret: string,
): { hasIntent: boolean; secretOk: boolean; stripped: string } {
  const raw = text.trim();
  const sec = secret.trim();
  if (!sec) {
    return { hasIntent: isEyeCommand(raw), secretOk: false, stripped: raw };
  }

  const esc = escapeRegExp(sec);
  const labeled = new RegExp(`\\s*口令\\s*[:：]?\\s*${esc}\\s*$`);
  const plain = new RegExp(`\\s+${esc}\\s*$`);

  let stripped = raw;
  let secretOk = false;
  if (labeled.test(raw)) {
    stripped = raw.replace(labeled, "").trim();
    secretOk = true;
  } else if (plain.test(raw)) {
    stripped = raw.replace(plain, "").trim();
    secretOk = true;
  }

  return {
    hasIntent: isEyeCommand(stripped),
    secretOk,
    stripped,
  };
}

export interface EyeSnapshot {
  mediaType: string;
  data: string;
  name: string;
  width?: number;
  height?: number;
}

/** Camera snapshot must stay on loopback — never fetch a remote eye URL. */
export function assertEyeUrlLocal(httpUrl: string): URL {
  const raw = httpUrl.trim();
  if (!raw) throw new Error("未配置 eye.httpUrl");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("eye.httpUrl 不是合法 URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("eye.httpUrl 只允许 http/https");
  }
  const host = parsed.hostname.toLowerCase();
  const local =
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]";
  if (!local) {
    throw new Error(`拒绝非本机眼睛地址（${host}）。只允许 127.0.0.1 / localhost`);
  }
  return parsed;
}

export async function fetchEyeSnapshot(opts: {
  httpUrl: string;
  timeoutMs?: number;
}): Promise<EyeSnapshot> {
  const parsed = assertEyeUrlLocal(opts.httpUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 12_000);
  try {
    const res = await fetch(parsed.toString(), { signal: ctrl.signal });
    const json = (await res.json()) as {
      ok?: boolean;
      error?: string;
      mediaType?: string;
      base64?: string;
      width?: number;
      height?: number;
    };
    if (!res.ok || !json.ok || !json.base64) {
      throw new Error(json.error || `eye HTTP ${res.status}`);
    }
    return {
      mediaType: json.mediaType || "image/jpeg",
      data: json.base64,
      name: "eye.jpg",
      width: json.width,
      height: json.height,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Owner +口令: open local camera via eye, describe via DSH vision.
 */
export async function handleEyeLook(opts: {
  cfg: AppConfig;
  userId: string;
  groupId?: string;
  text: string;
  dsh: DshApiClient;
  sessions: SessionStore;
  systemPrompt: string;
  sea?: MemorySea;
  vault?: EyeVault;
}): Promise<{ handled: true; reply: string } | { handled: false }> {
  const secret = resolveEyeSecret(opts.cfg);
  const peeled = peelEyeSecret(opts.text, secret);
  if (!peeled.hasIntent) return { handled: false };

  // Log without口令
  console.log(
    `[bridge] eye command hit user=${opts.userId} text=${peeled.stripped.slice(0, 40)} secret=${peeled.secretOk ? "ok" : "missing"}`,
  );

  if (!canUseEye(opts.userId, opts.cfg)) {
    return { handled: true, reply: "这双眼睛只听主人的。别人不能让我开摄像头。" };
  }

  // 没带对口令：不当眼睛指令，走普通闲聊（避免「口令不对」打断对话）。
  if (!secret || !peeled.secretOk) {
    return { handled: false };
  }

  const eye = opts.cfg.social.eye;
  const skillsOn = opts.cfg.social.skills?.eye !== false;
  if (!skillsOn || eye?.enabled === false) {
    return {
      handled: true,
      reply:
        "眼睛技能未开启。config 里设 social.skills.eye=true 且 social.eye.enabled=true，并先启动 pnpm eye。",
    };
  }

  if (opts.groupId && eye?.allowGroup !== true) {
    return {
      handled: true,
      reply: "群里先别让我开摄像头。私聊发「看看外面 口令」。",
    };
  }

  const httpUrl = eye?.httpUrl?.trim() || "http://127.0.0.1:8790/snapshot";
  let snap: EyeSnapshot;
  try {
    snap = await fetchEyeSnapshot({
      httpUrl,
      timeoutMs: eye?.timeoutMs ?? 12_000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      handled: true,
      reply:
        `眼睛这会儿睁不开：${msg}\n` +
        `请确认已运行 pnpm eye，且 Windows 允许摄像头；仅本机 127.0.0.1:8790。`,
    };
  }

  // Dedicated eye session — keep camera frames out of normal 私聊 history.
  const qqKey = qqSessionKey({
    userId: `eye-${opts.userId}`,
    groupId: undefined,
  });
  let mapping = opts.sessions.get(qqKey);
  if (!mapping) {
    const sessionId = await opts.dsh.ensureSession({
      key: qqKey,
      title: `眼睛保险柜 · ${opts.userId}`,
      systemPrompt: opts.systemPrompt,
    });
    mapping = {
      qqKey,
      sessionId,
      title: `眼睛 · ${opts.userId}`,
      updatedAt: new Date().toISOString(),
    };
    opts.sessions.set(mapping);
  }

  const message =
    `【系统·眼睛】附图是本机摄像头刚刚抓到的一帧（不是用户相册）。\n` +
    `请用当前人设口吻，用 2～4 句说说你此刻「看见」的：光、氛围、物件、大致场景。\n` +
    `禁止提摄像头/JPEG/分辨率/AI；不要认人脸点名；若画面太黑或模糊就诚实说看不清。`;

  try {
    const result = await opts.dsh.prompt({
      sessionId: mapping.sessionId,
      message,
      systemPrompt: opts.systemPrompt,
      images: [
        {
          mediaType: snap.mediaType,
          data: snap.data,
          name: snap.name,
        },
      ],
    });
    mapping.updatedAt = new Date().toISOString();
    opts.sessions.set(mapping);

    const reply = (result.text || "").trim().slice(0, 400) || "……眼前有点空，说不清。";
    if (opts.sea) {
      rememberEyeGlance(opts.sea, opts.userId, reply);
    }

    let vaultLine = "";
    if (opts.vault && secret) {
      const stashed = stashEyeFrame({
        vault: opts.vault,
        secret,
        jpegBase64: snap.data,
        note: reply,
        width: snap.width,
        height: snap.height,
      });
      if (stashed) {
        vaultLine =
          `\n（已锁进眼睛保险柜 #${stashed.id}。眼睛相册 口令 / 再看一眼 ${stashed.id} 口令 / 删除眼睛 ${stashed.id} 口令）`;
      }
    }

    return { handled: true, reply: reply + vaultLine };
  } catch (err) {
    return {
      handled: true,
      reply: `看见了画面，但描述失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function rememberEyeGlance(sea: MemorySea, userId: string, reply: string): void {
  const day = new Date().toISOString().slice(0, 10);
  const snippet = reply.replace(/\s+/g, " ").trim().slice(0, 48);
  try {
    sea.remember(
      { kind: "user", userId },
      {
        content: `${day} 睁眼看了一眼本机外面：${snippet}`,
        category: "chat_noise",
        importance: 0.2,
        confidence: 0.85,
        tags: ["eye"],
        visibility: "private",
        ownerId: userId,
      },
    );
  } catch {
    /* best-effort */
  }
}
