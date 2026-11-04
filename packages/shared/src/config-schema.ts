import { z } from "zod";

export const CategoryConfigSchema = z.object({
  baseLambda: z.number().positive(),
  defaultImportance: z.number().min(0).max(1),
});

export const MemoryConfigSchema = z.object({
  dbPath: z.string().default("data/memory/sea.sqlite"),
  injectCharLimit: z.number().int().positive().default(600),
  recallLimit: z.number().int().positive().default(6),
  pruneThreshold: z.number().min(0).max(1).default(0.05),
  categories: z
    .record(CategoryConfigSchema)
    .default({
      identity: { baseLambda: 0.012, defaultImportance: 0.9 },
      fact: { baseLambda: 0.018, defaultImportance: 0.7 },
      event: { baseLambda: 0.035, defaultImportance: 0.55 },
      assumption: { baseLambda: 0.045, defaultImportance: 0.4 },
      chat_noise: { baseLambda: 0.08, defaultImportance: 0.25 },
    }),
});

const DEFAULT_PROBE_PROMPTS = [
  "【系统】群里安静一会儿了。请用一两句自然、轻松的话主动开个小话题（不要说自己是系统提示）。需要时可附带一个 [[sticker:id]]。",
  "【系统】冷场了。用一句随意的问候或小问题把话题捡起来，语气轻松，别太长。可用 [[sticker:id]]。",
  "【系统】好久没人说话。像群友一样冒一句近况或分享欲，不要像播报。可用 [[sticker:id]]。",
];

export const AppConfigSchema = z.object({
  onebot: z
    .object({
      wsUrl: z.string().default("ws://127.0.0.1:3001"),
      httpUrl: z.string().default("http://127.0.0.1:3000"),
      accessToken: z.string().default(""),
      selfId: z.string().default(""),
    })
    .default({}),
  dsh: z
    .object({
      baseUrl: z.string().default("http://127.0.0.1:3080"),
      profile: z.string().default("desktop"),
      model: z.string().default(""),
      provider: z.string().default(""),
      lockModel: z.boolean().default(false),
      workspaceGroup: z.string().default("QQ 聊天"),
      cookie: z.string().default(""),
      autoMintCookie: z.boolean().default(true),
    })
    .default({}),
  access: z
    .object({
      admins: z.array(z.string()).default([]),
      allowUsers: z.array(z.string()).default([]),
      allowGroups: z.array(z.string()).default([]),
      requireMention: z.boolean().default(true),
      triggerNames: z.array(z.string()).default(["鲸鱼娘", "鲸鲸"]),
    })
    .default({}),
  memory: MemoryConfigSchema.default({}),
  bridge: z
    .object({
      textChunkLimit: z.number().int().positive().default(400),
      consoleToken: z.string().default(""),
      consolePort: z.number().int().positive().default(3120),
    })
    .default({}),
  persona: z
    .object({
      id: z.string().default("whale"),
      contentDir: z.string().default("packages/persona/content/whale"),
      /** Default preset pack id under presetsDir (e.g. 御姐宠). Empty = contentDir fallback. */
      preset: z.string().default("御姐宠"),
      /** Override presets directory; empty uses package presets/. */
      presetsDir: z.string().default(""),
    })
    .default({}),
  social: z
    .object({
      enabled: z.boolean().default(true),
      stickerDir: z.string().default("data/stickers"),
      idleOpenMs: z.number().int().positive().default(10 * 60 * 1000),
      diveAfterProbeMs: z.number().int().positive().default(5 * 60 * 1000),
      tickMs: z.number().int().positive().default(30_000),
      proactivePrompt: z.string().default(DEFAULT_PROBE_PROMPTS[0]!),
      /** Rotate among these for cold-open (falls back to proactivePrompt). */
      proactivePromptPool: z.array(z.string()).default(DEFAULT_PROBE_PROMPTS),
      /** Split model reply into bubbles by ||| or blank lines. */
      multiBubble: z.boolean().default(true),
      bubbleGapMinMs: z.number().int().nonnegative().default(800),
      bubbleGapMaxMs: z.number().int().nonnegative().default(2000),
      /** Artificial typing delay before each bubble. */
      typingDelay: z.boolean().default(true),
      typingMsPerChar: z.number().positive().default(30),
      typingMinMs: z.number().int().nonnegative().default(400),
      typingMaxMs: z.number().int().positive().default(2500),
      /** React to poke notices. */
      pokeEnabled: z.boolean().default(true),
      pokeReply: z.string().default("诶，戳我干嘛～有事直接说。"),
      /** Admin command: 收藏表情 <id> while quoting/sending an image. */
      stickerCollectEnabled: z.boolean().default(true),
      tts: z
        .object({
          enabled: z.boolean().default(false),
          /** HTTP TTS: POST { text, voice? } → audio bytes or { base64 }. */
          httpUrl: z.string().default(""),
          /** Passed to local TTS as voice id (edge-tts). */
          voice: z.string().default("zh-CN-XiaoxiaoNeural"),
          /**
           * ask = 用户说「用语音回复」等才语音
           * tag = 仅 [[voice:…]]
           * always = 每句文字都附带语音
           * voice_only = 只发语音
           */
          replyMode: z
            .enum(["ask", "tag", "always", "voice_only"])
            .default("ask"),
        })
        .default({}),
      /** Persona card / wake-context memory aids. */
      personaCardsEnabled: z.boolean().default(true),
      wakeContextEnabled: z.boolean().default(true),
      /** QQ 空间说说：管理员「发条动态」出草稿，确认后再发（需 NapCat send_qzone_msg）。 */
      qzone: z
        .object({
          enabled: z.boolean().default(true),
          /** 1所有人 4好友 16部分好友 64仅自己 */
          ugcRight: z.number().int().positive().default(4),
        })
        .default({}),
      /** Lightweight social skills (promises / whisper / sticker director / recall / taste / eye). */
      skills: z
        .object({
          promises: z.boolean().default(true),
          whisper: z.boolean().default(true),
          stickerDirector: z.boolean().default(true),
          recallSlice: z.boolean().default(true),
          tasteMap: z.boolean().default(true),
          /** Local camera via scripts/eye → DSH vision. */
          eye: z.boolean().default(true),
        })
        .default({}),
      /** 本机摄像头眼睛（pnpm eye）。仅 127.0.0.1。调用权写死为大号 QQ，见 bridge eye.ts。 */
      eye: z
        .object({
          enabled: z.boolean().default(true),
          httpUrl: z.string().default("http://127.0.0.1:8790/snapshot"),
          timeoutMs: z.number().int().positive().default(12_000),
          /**
           * 眼睛口令（必填）。用法：看看外面 口令
           * 也可被环境变量 EYE_SECRET 覆盖。兼作保险柜加密密钥。
           */
          secret: z.string().default(""),
          /** 加密保险柜最多保留张数（超出删最旧） */
          vaultMaxEntries: z.number().int().positive().default(30),
          /**
           * @deprecated 无效。眼睛调用权硬编码为 EYE_OWNER_QQ，不读 admins。
           */
          adminOnly: z.boolean().default(true),
          /** 群里允许开摄像头（仍须是硬编码主人号 + 口令；不推荐） */
          allowGroup: z.boolean().default(false),
        })
        .default({}),
    })
    .default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type CategoryConfig = z.infer<typeof CategoryConfigSchema>;

export function parseAppConfig(raw: unknown): AppConfig {
  return AppConfigSchema.parse(raw);
}
