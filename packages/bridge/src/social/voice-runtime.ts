import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  VOICE_PRESETS,
  findPresetByEdge,
  matchVoicePreset,
  settingsFromPreset,
  type VoicePreset,
  type VoiceSettings,
} from "./voice-presets.js";

export interface VoiceActiveState {
  presetId: string;
  edge: string;
  rate?: string;
  pitch?: string;
  updatedAt: string;
}

export class VoiceRuntime {
  readonly voiceRef: { current: VoiceSettings };
  private presetId: string;
  private readonly statePath: string;

  private constructor(statePath: string, preset: VoicePreset) {
    this.statePath = statePath;
    this.presetId = preset.id;
    this.voiceRef = { current: settingsFromPreset(preset) };
  }

  static create(opts: { statePath: string; defaultEdge?: string }): VoiceRuntime {
    const saved = readState(opts.statePath);
    let preset: VoicePreset | null = null;
    if (saved?.presetId) preset = matchVoicePreset(saved.presetId);
    if (!preset && saved?.edge) preset = findPresetByEdge(saved.edge);
    if (!preset && opts.defaultEdge) preset = findPresetByEdge(opts.defaultEdge);
    if (!preset) preset = VOICE_PRESETS[0]!;

    const rt = new VoiceRuntime(opts.statePath, preset);
    if (!saved) rt.persist();
    return rt;
  }

  get currentPresetId(): string {
    return this.presetId;
  }

  get edgeVoice(): string {
    return this.voiceRef.current.edge;
  }

  switchTo(name: string): { ok: true; preset: VoicePreset } | { ok: false; error: string } {
    const preset = matchVoicePreset(name);
    if (!preset) {
      return {
        ok: false,
        error: `找不到配音「${name}」。发 /配音 查看列表。`,
      };
    }
    this.presetId = preset.id;
    this.voiceRef.current = settingsFromPreset(preset);
    this.persist();
    return { ok: true, preset };
  }

  formatStatus(): string {
    const cur = VOICE_PRESETS.find((p) => p.id === this.presetId);
    const s = this.voiceRef.current;
    const lines = [
      `当前配音：${this.presetId}${cur ? `（${cur.gender}·${cur.blurb}）` : ""}`,
      `引擎：${s.edge}  pitch=${s.pitch} rate=${s.rate}`,
      "可用：",
    ];
    for (const p of VOICE_PRESETS) {
      const mark = p.id === this.presetId ? "◀" : "·";
      lines.push(`${mark}${p.id} ${p.gender} ${p.blurb}`);
    }
    lines.push("切换：/配音 可莉　或　/音色 萝莉");
    return lines.join("\n");
  }

  private persist(): void {
    mkdirSync(path.dirname(this.statePath), { recursive: true });
    const s = this.voiceRef.current;
    const state: VoiceActiveState = {
      presetId: this.presetId,
      edge: s.edge,
      rate: s.rate,
      pitch: s.pitch,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(this.statePath, JSON.stringify(state, null, 2), "utf8");
  }
}

function readState(statePath: string): VoiceActiveState | null {
  try {
    if (!existsSync(statePath)) return null;
    const raw = JSON.parse(readFileSync(statePath, "utf8")) as VoiceActiveState;
    if (!raw || typeof raw !== "object") return null;
    return {
      presetId: String(raw.presetId || ""),
      edge: String(raw.edge || ""),
      rate: raw.rate ? String(raw.rate) : undefined,
      pitch: raw.pitch ? String(raw.pitch) : undefined,
      updatedAt: String(raw.updatedAt || ""),
    };
  } catch {
    return null;
  }
}
