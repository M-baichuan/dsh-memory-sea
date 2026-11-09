import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeSystemPrompt, type PersonaBundle } from "./index.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function defaultPresetsDir(): string {
  return path.join(packageRoot, "presets");
}

export function resolvePresetsDir(custom?: string): string {
  if (custom?.trim()) return path.resolve(custom.trim());
  return defaultPresetsDir();
}

export function listPersonaPresets(presetsDir = defaultPresetsDir()): string[] {
  if (!existsSync(presetsDir)) return [];
  return readdirSync(presetsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(path.join(presetsDir, name, "SOUL.md")))
    .sort((a, b) => a.localeCompare(b, "zh"));
}

export async function loadPersonaPreset(
  id: string,
  presetsDir = defaultPresetsDir(),
): Promise<PersonaBundle> {
  const dir = path.join(presetsDir, id);
  if (!existsSync(path.join(dir, "SOUL.md"))) {
    throw new Error(`人设预设不存在：${id}`);
  }
  const [soul, style, boundaries] = await Promise.all([
    readFile(path.join(dir, "SOUL.md"), "utf8"),
    readFile(path.join(dir, "STYLE.md"), "utf8").catch(() => ""),
    readFile(path.join(dir, "BOUNDARIES.md"), "utf8").catch(() => ""),
  ]);
  return { id, soul, style, boundaries };
}

export async function composePresetPrompt(
  id: string,
  presetsDir = defaultPresetsDir(),
): Promise<string> {
  const bundle = await loadPersonaPreset(id, presetsDir);
  return composeSystemPrompt(bundle);
}

export function matchPresetName(input: string, presets: string[]): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (presets.includes(raw)) return raw;
  const lower = raw.toLowerCase();
  const hit = presets.find((p) => p.toLowerCase() === lower);
  if (hit) return hit;
  const partial = presets.filter((p) => p.includes(raw) || raw.includes(p));
  return partial.length === 1 ? partial[0]! : null;
}
