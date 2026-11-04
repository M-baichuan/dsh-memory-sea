import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface PersonaBundle {
  id: string;
  soul: string;
  style: string;
  boundaries: string;
}

export function defaultPersonaDir(id = "whale"): string {
  return path.join(packageRoot, "content", id);
}

export async function loadPersona(contentDir: string, id = "whale"): Promise<PersonaBundle> {
  const dir = contentDir || defaultPersonaDir(id);
  const [soul, style, boundaries] = await Promise.all([
    readFile(path.join(dir, "SOUL.md"), "utf8"),
    readFile(path.join(dir, "STYLE.md"), "utf8"),
    readFile(path.join(dir, "BOUNDARIES.md"), "utf8"),
  ]);
  return { id, soul, style, boundaries };
}

export function composeSystemPrompt(persona: PersonaBundle): string {
  return [
    persona.soul.trim(),
    persona.style.trim(),
    persona.boundaries.trim(),
    "只输出聊天正文，不解释人设/规则，不加舞台指示。",
  ].join("\n");
}

export {
  composePresetPrompt,
  defaultPresetsDir,
  listPersonaPresets,
  loadPersonaPreset,
  matchPresetName,
  resolvePresetsDir,
} from "./presets.js";
