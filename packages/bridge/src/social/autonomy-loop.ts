import type { AppConfig } from "@dsh-memory-sea/shared";
import type { DshApiClient } from "../dsh/api-client.js";
import { qqSessionKey, type SessionStore } from "../dsh/sessions.js";
import type { OneBotClient } from "../onebot/client.js";
import type { GroupRecentLog } from "./group-recent.js";
import type { PresenceStore } from "./presence.js";
import type { PromiseStore } from "./promises.js";
import type { QzoneDraftStore } from "./qzone-draft.js";
import type { StickerEntry } from "./stickers.js";
import { resolveOwnerQq } from "./eye.js";
import {
  AutonomyPolicy,
  scopeKeyFor,
} from "./autonomy-policy.js";
import {
  buildAutonomyDecidePrompt,
  parseAutonomyDecision,
  type AutonomyAssertiveness,
  type AutonomyChannel,
} from "./autonomy-decide.js";
import {
  allowedToolNames,
  executeAutonomyDecision,
  resolveToolFlags,
} from "./autonomy-tools.js";

export interface AutonomyLoopDeps {
  cfg: AppConfig;
  client: OneBotClient;
  dsh: DshApiClient;
  sessions: SessionStore;
  presence: PresenceStore;
  groupRecent: GroupRecentLog;
  policy: AutonomyPolicy;
  stickersRef: { current: StickerEntry[] };
  systemPromptRef: { current: string };
  voiceRef?: { current: { edge: string; rate: string; pitch: string } };
  promises?: PromiseStore;
  qzoneDrafts?: QzoneDraftStore;
}

export type AutonomyCandidate =
  | { kind: "group"; groupId: string; idleMs: number; softWake?: boolean }
  | { kind: "private"; userId: string; idleMs: number };

let rrCursor = 0;
/** Alternate bias: 0 prefer group, 1 prefer private when both exist. */
let channelBias = 0;

export function startAutonomyLoop(deps: AutonomyLoopDeps): () => void {
  const auto = deps.cfg.social.autonomy;
  if (!auto?.enabled) return () => undefined;

  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runAutonomyTick(deps);
    } catch (err) {
      console.warn(
        "[autonomy] tick failed:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, Math.max(30_000, auto.tickMs));
  const boot = setTimeout(() => {
    void tick();
  }, Math.min(45_000, Math.max(8_000, Math.floor(auto.tickMs / 2))));

  return () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(boot);
  };
}

export async function runAutonomyTick(deps: AutonomyLoopDeps): Promise<void> {
  const auto = deps.cfg.social.autonomy;
  if (!auto?.enabled) return;
  if (deps.policy.isGloballyMuted()) {
    console.log("[autonomy] skip: globally muted");
    return;
  }
  if (
    deps.policy.inQuietHours({
      startHour: auto.quietStartHour,
      endHour: auto.quietEndHour,
    })
  ) {
    console.log("[autonomy] skip: quiet hours");
    return;
  }

  const groups = deps.cfg.access.allowGroups.filter(Boolean);
  const candidates = collectCandidates(deps, groups, {
    minGroupIdleMs: auto.minGroupIdleMs,
    allowPrivate: auto.allowPrivate !== false,
    privateOwnerOnly: auto.privateOwnerOnly !== false,
    minPrivateIdleMs: auto.minPrivateIdleMs,
  });
  const candidate = pickCandidate(candidates, channelBias);
  channelBias = 1 - channelBias;

  if (!candidate) {
    console.log("[autonomy] skip: no idle candidate");
    return;
  }

  const isPrivate = candidate.kind === "private";
  const sk = isPrivate
    ? scopeKeyFor({ userId: candidate.userId })
    : scopeKeyFor({ groupId: candidate.groupId });

  if (!isPrivate && deps.policy.isGroupMuted(candidate.groupId)) {
    console.log(`[autonomy] skip: group muted ${candidate.groupId}`);
    return;
  }

  const quota = deps.policy.canAct(sk, {
    isPrivate,
    maxPerHour: auto.maxPerHour,
    maxPrivatePerHour: auto.maxPrivatePerHour,
  });
  if (!quota.ok) {
    console.log(`[autonomy] skip: ${quota.reason}`);
    return;
  }

  const channel: AutonomyChannel = isPrivate ? "private" : "group";
  const tools = resolveToolFlags(deps.cfg);
  const allowed = allowedToolNames(tools);
  const stickers = deps.stickersRef.current;
  const recent =
    candidate.kind === "group"
      ? deps.groupRecent.formatDigest(candidate.groupId, 8)
      : "";
  const assertiveness = (auto.assertiveness ?? "high") as AutonomyAssertiveness;

  const prompt = buildAutonomyDecidePrompt({
    systemPrompt: deps.systemPromptRef.current,
    channel,
    groupId: candidate.kind === "group" ? candidate.groupId : undefined,
    ownerUserId: isPrivate ? candidate.userId : resolveOwnerQq(deps.cfg),
    idleMinutes: Math.max(1, Math.round(candidate.idleMs / 60_000)),
    minIdleMinutes: Math.max(
      1,
      Math.round(
        (isPrivate ? auto.minPrivateIdleMs : auto.minGroupIdleMs) / 60_000,
      ),
    ),
    recent,
    allowedTools: allowed,
    stickerIds: stickers.map((s) => s.id),
    assertiveness,
  });

  const sessionId = await ensureAutonomySession(deps);
  const result = await deps.dsh.prompt({
    sessionId,
    message: prompt,
    systemPrompt: deps.systemPromptRef.current,
  });
  const decision = parseAutonomyDecision(result.text || "");
  // Force channel to match the candidate we picked (model may mislabel).
  decision.channel = channel;
  if (isPrivate) decision.userId = candidate.userId;

  console.log(
    `[autonomy] decide ${channel}` +
      (isPrivate ? ` u=${candidate.userId}` : ` g=${candidate.groupId}`) +
      ` action=${decision.action}` +
      (decision.reason ? ` reason=${decision.reason}` : ""),
  );

  if (decision.action === "noop") return;

  if (deps.policy.isGloballyMuted()) return;
  if (!isPrivate && deps.policy.isGroupMuted(candidate.groupId)) return;
  if (
    isPrivate &&
    !deps.policy.privateIdleOk(candidate.userId, auto.minPrivateIdleMs)
  ) {
    return;
  }

  const quota2 = deps.policy.canAct(sk, {
    isPrivate,
    maxPerHour: auto.maxPerHour,
    maxPrivatePerHour: auto.maxPrivatePerHour,
  });
  if (!quota2.ok) return;

  const exec = await executeAutonomyDecision(
    {
      cfg: deps.cfg,
      client: deps.client,
      stickers,
      promises: deps.promises,
      qzoneDrafts: deps.qzoneDrafts,
      voiceRef: deps.voiceRef,
      tools,
    },
    {
      target: isPrivate
        ? { userId: candidate.userId }
        : { groupId: candidate.groupId },
      decision,
    },
  );

  if (exec.ok) {
    deps.policy.recordAct(sk);
    if (isPrivate) {
      deps.policy.notePrivateAct(candidate.userId);
    } else {
      deps.presence.markProbed(candidate.groupId);
    }
  }
  console.log(
    `[autonomy] exec ${exec.ok ? "ok" : "fail"} ${exec.summary}`,
  );
}

export function collectCandidates(
  deps: AutonomyLoopDeps,
  groups: string[],
  opts: {
    minGroupIdleMs: number;
    allowPrivate: boolean;
    privateOwnerOnly: boolean;
    minPrivateIdleMs: number;
    now?: number;
  },
): AutonomyCandidate[] {
  const now = opts.now ?? Date.now();
  const out: AutonomyCandidate[] = [];

  for (const groupId of groups) {
    if (deps.policy.isGroupMuted(groupId)) continue;
    const row = deps.presence.get(groupId);
    const idleMs = now - (row.lastHumanAt || 0);
    if (row.phase === "diving") {
      // Soft wake: only after 2× idle threshold
      if (idleMs >= opts.minGroupIdleMs * 2) {
        out.push({ kind: "group", groupId, idleMs, softWake: true });
      }
      continue;
    }
    if (idleMs < opts.minGroupIdleMs) continue;
    out.push({ kind: "group", groupId, idleMs });
  }

  if (opts.allowPrivate) {
    const userId = resolveOwnerQq(deps.cfg);
    if (
      deps.policy.privateIdleOk(userId, opts.minPrivateIdleMs, now) &&
      deps.policy.canAct(scopeKeyFor({ userId }), {
        isPrivate: true,
        maxPerHour: deps.cfg.social.autonomy?.maxPerHour ?? 6,
        maxPrivatePerHour: deps.cfg.social.autonomy?.maxPrivatePerHour ?? 4,
      }).ok
    ) {
      out.push({
        kind: "private",
        userId,
        idleMs: deps.policy.privateIdleElapsed(userId, now),
      });
    }
  }

  return out;
}

/** Round-robin among groups; honor channelBias when both kinds present. */
export function pickCandidate(
  candidates: AutonomyCandidate[],
  bias: number,
): AutonomyCandidate | null {
  if (!candidates.length) return null;
  const groups = candidates.filter((c) => c.kind === "group");
  const privates = candidates.filter((c) => c.kind === "private");

  if (groups.length && privates.length) {
    if (bias % 2 === 1) return privates[0]!;
    // Prefer longest-idle group among ordered slice
    const ordered = rotate(groups, rrCursor);
    rrCursor = (rrCursor + 1) % groups.length;
    return ordered[0]!;
  }
  if (groups.length) {
    const ordered = rotate(groups, rrCursor);
    rrCursor = (rrCursor + 1) % groups.length;
    return ordered[0]!;
  }
  return privates[0] ?? null;
}

function rotate<T>(arr: T[], start: number): T[] {
  if (!arr.length) return [];
  const i = ((start % arr.length) + arr.length) % arr.length;
  return [...arr.slice(i), ...arr.slice(0, i)];
}

async function ensureAutonomySession(deps: AutonomyLoopDeps): Promise<string> {
  const qqKey = qqSessionKey({ userId: "autonomy", groupId: "tick" });
  const title = "自主决策";
  let mapping = deps.sessions.get(qqKey);
  if (!mapping) {
    const sessionId = await deps.dsh.ensureSession({
      key: qqKey,
      title,
      systemPrompt: deps.systemPromptRef.current,
    });
    mapping = {
      qqKey,
      sessionId,
      title,
      updatedAt: new Date().toISOString(),
    };
    deps.sessions.set(mapping);
  }
  return mapping.sessionId;
}
