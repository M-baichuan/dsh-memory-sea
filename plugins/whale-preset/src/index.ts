import fs from "node:fs";
import path from "node:path";
import { composeSystemPrompt, defaultPersonaDir, loadPersona } from "@dsh-memory-sea/persona";

export const name = "@dsh-memory-sea/whale-preset";

/** Cordis: accessing ctx.agentPresets without inject throws. */
export const inject = ["agentPresets"];

export interface CordisLikeContext {
  agentPresets?: {
    register?: (preset: {
      id: string;
      name: string;
      systemPrompt: string;
    }) => void;
  };
  logger?: { info: (msg: string) => void };
}

function resolveWhalePersonaDir(): string {
  const candidates = [
    process.env.MEMORY_SEA_PERSONA_DIR,
    defaultPersonaDir("whale"),
    // Absolute fallback: monorepo content (DSH desktop cwd is the profile dir).
    "D:\\memory_sea_project\\packages\\persona\\content\\whale",
  ].filter((v): v is string => Boolean(v && String(v).trim()));

  for (const candidate of candidates) {
    const abs = path.isAbsolute(candidate)
      ? candidate
      : path.resolve(candidate);
    if (fs.existsSync(path.join(abs, "SOUL.md"))) return abs;
  }

  throw new Error(
    `[whale-preset] persona not found. Tried: ${candidates.join(" | ")}. ` +
      `Set MEMORY_SEA_PERSONA_DIR to the absolute path of packages/persona/content/whale`,
  );
}

export async function apply(ctx: CordisLikeContext) {
  // Do NOT resolve via process.cwd() — desktop host cwd is the profile dir, so
  // relative `packages/persona/content/whale` is missing there.
  const contentDir = resolveWhalePersonaDir();
  ctx.logger?.info?.(`[whale-preset] persona dir: ${contentDir}`);
  const persona = await loadPersona(contentDir, "whale");
  const systemPrompt = composeSystemPrompt(persona);

  ctx.agentPresets?.register?.({
    id: "whale",
    name: "鲸鱼娘",
    systemPrompt,
  });
  ctx.logger?.info?.("[whale-preset] registered preset: whale");
}

export { composeSystemPrompt, loadPersona };
