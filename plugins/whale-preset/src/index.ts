import path from "node:path";
import { composeSystemPrompt, loadPersona } from "@dsh-memory-sea/persona";

export const name = "@dsh-memory-sea/whale-preset";

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

export async function apply(ctx: CordisLikeContext) {
  const contentDir =
    process.env.MEMORY_SEA_PERSONA_DIR ??
    path.resolve(process.cwd(), "packages/persona/content/whale");
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
