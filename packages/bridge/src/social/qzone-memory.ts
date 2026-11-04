import type { AppConfig } from "@dsh-memory-sea/shared";
import type { MemorySea } from "@dsh-memory-sea/memory-sea";

/**
 * After a real QZone publish: leave a light chat_noise crumb so later
 * chats can nod at it without treating it as a life event.
 */
export function rememberQzonePublish(
  sea: MemorySea,
  cfg: AppConfig,
  opts: {
    adminId: string;
    typeId?: string;
    content: string;
  },
): void {
  const day = new Date().toISOString().slice(0, 10);
  const typeLabel = (opts.typeId ?? "").trim() || "随想";
  const snippet = opts.content.replace(/\s+/g, " ").trim().slice(0, 48);
  const text =
    `${day} 在 QQ 空间发过一条「${typeLabel}」类说说` +
    (snippet ? `：${snippet}` : "");

  const base = {
    content: text,
    category: "chat_noise" as const,
    importance: 0.22,
    confidence: 0.92,
    tags: ["qzone", typeLabel],
  };

  try {
    sea.remember(
      { kind: "user", userId: opts.adminId },
      {
        ...base,
        visibility: "private",
        ownerId: opts.adminId,
      },
    );
  } catch (err) {
    console.warn(
      "[bridge] qzone memory (admin) skipped:",
      err instanceof Error ? err.message : err,
    );
  }

  // Soft fan-out: co-admins + allowlisted groups can also lightly recall.
  for (const uid of cfg.access.admins) {
    if (uid === opts.adminId) continue;
    try {
      sea.remember(
        { kind: "user", userId: uid },
        {
          ...base,
          visibility: "private",
          ownerId: uid,
        },
      );
    } catch {
      /* best-effort */
    }
  }

  for (const groupId of cfg.access.allowGroups) {
    try {
      sea.remember(
        { kind: "group", groupId },
        {
          ...base,
          visibility: "group",
          groupId,
        },
      );
    } catch {
      /* best-effort */
    }
  }
}
