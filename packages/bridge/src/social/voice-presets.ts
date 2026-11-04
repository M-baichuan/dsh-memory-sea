/** Friendly QQ-switchable TTS presets → edge-tts ShortName (+ optional pitch/rate). */
export interface VoicePreset {
  id: string;
  /** edge-tts voice id */
  edge: string;
  gender: "女" | "男";
  blurb: string;
  aliases?: string[];
  /** edge-tts rate, e.g. +10% */
  rate?: string;
  /** edge-tts pitch, e.g. +40Hz — 抬高更偏幼/萝莉感 */
  pitch?: string;
}

export interface VoiceSettings {
  edge: string;
  rate: string;
  pitch: string;
}

export function settingsFromPreset(p: VoicePreset): VoiceSettings {
  return {
    edge: p.edge,
    rate: p.rate?.trim() || "+0%",
    pitch: p.pitch?.trim() || "+0Hz",
  };
}

export const VOICE_PRESETS: VoicePreset[] = [
  { id: "晓晓", edge: "zh-CN-XiaoxiaoNeural", gender: "女", blurb: "清亮自然（默认）", aliases: ["清亮", "默认"] },
  { id: "晓伊", edge: "zh-CN-XiaoyiNeural", gender: "女", blurb: "偏柔温", aliases: ["柔声", "柔"] },
  {
    id: "萝莉",
    edge: "zh-CN-XiaoxiaoNeural",
    gender: "女",
    blurb: "元气幼声（高 pitch）",
    aliases: ["幼女", "软萌", "元气"],
    rate: "+18%",
    pitch: "+78Hz",
  },
  {
    id: "可莉",
    edge: "zh-CN-XiaoxiaoNeural",
    gender: "女",
    blurb: "更蹦更尖·仿可莉感（非原声）",
    aliases: ["火花骑士", "蹦蹦炸弹", "元气萝莉"],
    rate: "+24%",
    pitch: "+92Hz",
  },
  {
    id: "奶声",
    edge: "zh-CN-XiaoxiaoNeural",
    gender: "女",
    blurb: "最高调奶声感",
    aliases: ["幼声", "娃娃音"],
    rate: "+16%",
    pitch: "+105Hz",
  },
  { id: "晓北", edge: "zh-CN-liaoning-XiaobeiNeural", gender: "女", blurb: "东北口音", aliases: ["东北"] },
  { id: "晓妮", edge: "zh-CN-shaanxi-XiaoniNeural", gender: "女", blurb: "陕西口音", aliases: ["陕西"] },
  { id: "云希", edge: "zh-CN-YunxiNeural", gender: "男", blurb: "年轻男声", aliases: ["少年"] },
  { id: "云健", edge: "zh-CN-YunjianNeural", gender: "男", blurb: "沉稳男声", aliases: ["沉稳"] },
  { id: "云夏", edge: "zh-CN-YunxiaNeural", gender: "男", blurb: "明朗男声" },
  { id: "云扬", edge: "zh-CN-YunyangNeural", gender: "男", blurb: "播音感男声", aliases: ["播音"] },
  { id: "晓臻", edge: "zh-TW-HsiaoChenNeural", gender: "女", blurb: "台湾女声", aliases: ["台湾", "台女"] },
  { id: "晓雨", edge: "zh-TW-HsiaoYuNeural", gender: "女", blurb: "台湾软女声" },
  { id: "云哲", edge: "zh-TW-YunJheNeural", gender: "男", blurb: "台湾男声", aliases: ["台男"] },
  { id: "晓佳", edge: "zh-HK-HiuGaaiNeural", gender: "女", blurb: "粤语女声", aliases: ["粤女"] },
  { id: "晓曼", edge: "zh-HK-HiuMaanNeural", gender: "女", blurb: "港普女声", aliases: ["港女"] },
  { id: "云龙", edge: "zh-HK-WanLungNeural", gender: "男", blurb: "粤语男声", aliases: ["粤男"] },
];

export function listVoicePresetIds(): string[] {
  return VOICE_PRESETS.map((p) => p.id);
}

export function matchVoicePreset(input: string): VoicePreset | null {
  const raw = input.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  for (const p of VOICE_PRESETS) {
    if (p.id === raw || p.id.toLowerCase() === lower) return p;
    if (p.edge.toLowerCase() === lower && !p.pitch && !p.rate) return p;
    if (p.aliases?.some((a) => a === raw || a.toLowerCase() === lower)) return p;
  }

  const partial = VOICE_PRESETS.filter(
    (p) =>
      p.id.includes(raw) ||
      raw.includes(p.id) ||
      p.aliases?.some((a) => a.includes(raw) || raw.includes(a)),
  );
  return partial.length === 1 ? partial[0]! : null;
}

export function findPresetByEdge(edge: string): VoicePreset | null {
  const lower = edge.trim().toLowerCase();
  // Prefer plain (no pitch) preset for the same engine voice
  return (
    VOICE_PRESETS.find((p) => p.edge.toLowerCase() === lower && !p.pitch && !p.rate) ??
    VOICE_PRESETS.find((p) => p.edge.toLowerCase() === lower) ??
    null
  );
}
