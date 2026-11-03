import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  composePresetPrompt,
  composeSystemPrompt,
  listPersonaPresets,
  loadPersona,
  matchPresetName,
  resolvePresetsDir,
} from "@dsh-memory-sea/persona";

export interface PersonaActiveState {
  presetId: string | null;
  updatedAt: string;
}

export interface PersonaRuntimeOpts {
  root: string;
  statePath: string;
  contentDir: string;
  personaId: string;
  defaultPreset: string;
  presetsDir?: string;
  /** Extra lines appended after compose (stickers / tts hints). */
  buildSuffix: () => string;
}

/**
 * Mutable system prompt holder — QQ admin can hot-switch preset packs.
 */
export class PersonaRuntime {
  readonly systemPromptRef: { current: string };
  private presetId: string | null = null;
  private readonly presetsDir: string;
  private readonly opts: PersonaRuntimeOpts;

  private constructor(opts: PersonaRuntimeOpts, initial: { presetId: string | null; prompt: string }) {
    this.opts = opts;
    this.presetsDir = resolvePresetsDir(
      opts.presetsDir?.trim()
        ? path.isAbsolute(opts.presetsDir)
          ? opts.presetsDir
          : path.join(opts.root, opts.presetsDir)
        : undefined,
    );
    this.presetId = initial.presetId;
    this.systemPromptRef = { current: initial.prompt };
  }

  static async create(opts: PersonaRuntimeOpts): Promise<PersonaRuntime> {
    const rt = new PersonaRuntime(opts, { presetId: null, prompt: "" });
    await rt.bootstrap();
    return rt;
  }

  get currentPresetId(): string | null {
    return this.presetId;
  }

  get systemPrompt(): string {
    return this.systemPromptRef.current;
  }

  listPresets(): string[] {
    return listPersonaPresets(this.presetsDir);
  }

  async switchTo(name: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
    const presets = this.listPresets();
    const id = matchPresetName(name, presets);
    if (!id) {
      return {
        ok: false,
        error: presets.length
          ? `找不到人设「${name}」。可用：${presets.join("、")}`
          : "还没有人设预设。",
      };
    }
    await this.applyPreset(id);
    this.persist();
    return { ok: true, id };
  }

  async reload(): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
    try {
      if (this.presetId) {
        await this.applyPreset(this.presetId);
      } else {
        await this.applyContentDir();
      }
      this.persist();
      return { ok: true, id: this.presetId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  formatStatus(): string {
    const presets = this.listPresets();
    const cur = this.presetId ?? `（文件）${this.opts.personaId}`;
    const lines = [`当前人设：${cur}`, `可用预设：${presets.length ? presets.join("、") : "（无）"}`];
    lines.push("切换：/人设 <名称>　重载：/人设重载");
    return lines.join("\n");
  }

  private async bootstrap(): Promise<void> {
    const saved = this.readState();
    const candidates = [
      saved?.presetId,
      this.opts.defaultPreset.trim() || null,
      "御姐宠",
    ].filter((x): x is string => Boolean(x));

    const presets = this.listPresets();
    for (const cand of candidates) {
      const id = matchPresetName(cand, presets);
      if (id) {
        await this.applyPreset(id);
        if (!saved?.presetId) this.persist();
        return;
      }
    }

    await this.applyContentDir();
    if (!saved) this.persist();
  }

  private async applyPreset(id: string): Promise<void> {
    const base = await composePresetPrompt(id, this.presetsDir);
    this.presetId = id;
    this.systemPromptRef.current = this.withSuffix(base);
  }

  private async applyContentDir(): Promise<void> {
    const bundle = await loadPersona(this.opts.contentDir, this.opts.personaId);
    this.presetId = null;
    this.systemPromptRef.current = this.withSuffix(composeSystemPrompt(bundle));
  }

  private withSuffix(base: string): string {
    const suffix = this.opts.buildSuffix().trim();
    return suffix ? `${base}\n${suffix}` : base;
  }

  private readState(): PersonaActiveState | null {
    try {
      if (!existsSync(this.opts.statePath)) return null;
      const raw = JSON.parse(readFileSync(this.opts.statePath, "utf8")) as PersonaActiveState;
      if (!raw || typeof raw !== "object") return null;
      return {
        presetId: raw.presetId ?? null,
        updatedAt: raw.updatedAt || "",
      };
    } catch {
      return null;
    }
  }

  private persist(): void {
    mkdirSync(path.dirname(this.opts.statePath), { recursive: true });
    const state: PersonaActiveState = {
      presetId: this.presetId,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(this.opts.statePath, JSON.stringify(state, null, 2), "utf8");
  }
}
