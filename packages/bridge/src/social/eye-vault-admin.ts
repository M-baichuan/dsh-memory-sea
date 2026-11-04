import type { AppConfig } from "@dsh-memory-sea/shared";
import type { OneBotClient } from "../onebot/client.js";
import { sendImage } from "../onebot/send.js";
import {
  canUseEye,
  peelEyeSecret,
  resolveEyeSecret,
} from "./eye.js";
import {
  EyeVault,
  formatVaultList,
  type EyeVaultEntryMeta,
} from "./eye-vault.js";

const LIST_RE = /^(?:眼睛相册|保险柜|\/眼睛相册)\s*$/;
const VIEW_RE = /^(?:再看一眼|看保险柜)\s+(\S+)\s*$/;
const DEL_RE = /^(?:删除眼睛|删眼睛)\s+(\S+)\s*$/;
const CLEAR_RE = /^(?:清空眼睛相册|清空保险柜)\s*$/;

export function isEyeVaultCommand(text: string): boolean {
  const t = text.trim();
  // Intent without secret first — peel happens in handler
  const strippedGuess = t.replace(/\s+口令\s*[:：]?\s*\S+\s*$/, "").replace(/\s+\S+\s*$/, "").trim();
  // Too aggressive. Better: peel with known secret in handler only.
  // Here detect keywords:
  return (
    /^(?:眼睛相册|保险柜|\/眼睛相册)(?:\s|$)/.test(t) ||
    /^(?:再看一眼|看保险柜)(?:\s|$)/.test(t) ||
    /^(?:删除眼睛|删眼睛)(?:\s|$)/.test(t) ||
    /^(?:清空眼睛相册|清空保险柜)(?:\s|$)/.test(t)
  );
}

/**
 * Private encrypted eye album — owner QQ +口令 only.
 * 再看一眼 only sends image in private chat (never group).
 */
export async function handleEyeVaultAdmin(opts: {
  cfg: AppConfig;
  userId: string;
  groupId?: string;
  text: string;
  client: OneBotClient;
  vault: EyeVault;
  chunkLimit: number;
}): Promise<{ handled: true; reply?: string } | { handled: false }> {
  if (!isEyeVaultCommand(opts.text)) return { handled: false };

  if (!canUseEye(opts.userId)) {
    return { handled: true, reply: "保险柜只认主人。别人打不开。" };
  }

  const secret = resolveEyeSecret(opts.cfg);
  const peeled = peelEyeSecret(opts.text, secret);
  // 没带对口令：不当保险柜指令，避免冒出「口令不对」。
  if (!secret || !peeled.secretOk) {
    return { handled: false };
  }

  const body = peeled.stripped.trim();
  console.log(`[bridge] eye-vault cmd user=${opts.userId} body=${body.slice(0, 40)}`);

  try {
    if (LIST_RE.test(body)) {
      const entries = opts.vault.list(secret);
      return { handled: true, reply: formatVaultList(entries) };
    }

    const view = body.match(VIEW_RE);
    if (view?.[1]) {
      if (opts.groupId) {
        return { handled: true, reply: "保险柜原图只走私聊。私聊发：再看一眼 1 口令" };
      }
      const { meta, jpeg } = opts.vault.getJpeg(secret, view[1]);
      await sendImage(opts.client, {
        userId: opts.userId,
        base64: jpeg.toString("base64"),
      });
      return {
        handled: true,
        reply: formatViewCaption(meta),
      };
    }

    const del = body.match(DEL_RE);
    if (del?.[1]) {
      const meta = opts.vault.delete(secret, del[1]);
      return { handled: true, reply: `已从保险柜撕掉 ${meta.id}。` };
    }

    if (CLEAR_RE.test(body)) {
      const n = opts.vault.clear(secret);
      return { handled: true, reply: `保险柜已清空（${n} 张）。` };
    }

    return {
      handled: true,
      reply:
        "保险柜用法：\n眼睛相册 口令\n再看一眼 1 口令\n删除眼睛 1 口令\n清空眼睛相册 口令",
    };
  } catch (err) {
    return {
      handled: true,
      reply: `保险柜：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function formatViewCaption(meta: EyeVaultEntryMeta): string {
  const when = meta.createdAt.replace("T", " ").slice(0, 16);
  const note = meta.note ? `\n当时：${meta.note}` : "";
  return `保险柜 #${meta.id}（${when}）${note}\n删掉：删除眼睛 ${meta.id} 口令`;
}

/** Persist a successful glance into the encrypted vault (best-effort). */
export function stashEyeFrame(opts: {
  vault: EyeVault;
  secret: string;
  jpegBase64: string;
  note?: string;
  width?: number;
  height?: number;
}): EyeVaultEntryMeta | null {
  try {
    const jpeg = Buffer.from(opts.jpegBase64, "base64");
    if (jpeg.length < 32) return null;
    return opts.vault.add(opts.secret, {
      jpeg,
      note: opts.note,
      width: opts.width,
      height: opts.height,
    });
  } catch (err) {
    console.warn(
      "[bridge] eye vault stash failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
