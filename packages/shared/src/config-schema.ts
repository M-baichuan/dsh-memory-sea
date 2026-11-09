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
      /**
       * Agent workspace disk root. Empty = `<repo>/data/agents`.
       * Not the same as workspaceGroup (display title only).
       */
      workspaceRoot: z.string().default(""),
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
      /** How she addresses the owner in chat (injected into system prompt). */
      ownerTitle: z.string().default("主人"),
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
      /**
       * Allow [[搜表情:关键词]] via OneBot (SnowLuma search_sys_faces / favorites).
       * Not QQ marketplace meme search — protocol usually doesn't expose that.
       */
      stickerSearch: z.boolean().default(true),
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
      /** Lightweight social skills (promises / whisper / sticker director / recall / taste / eye / knowledge). */
      skills: z
        .object({
          promises: z.boolean().default(true),
          whisper: z.boolean().default(true),
          stickerDirector: z.boolean().default(true),
          recallSlice: z.boolean().default(true),
          tasteMap: z.boolean().default(true),
          /** Local camera via scripts/eye → DSH vision. */
          eye: z.boolean().default(true),
          /** Local md/pdf knowledge base (RAG-lite keyword retrieve). */
          knowledge: z.boolean().default(true),
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
           * @deprecated 无效。眼睛调用权优先读 access.admins[0]，常量仅兜底。
           */
          adminOnly: z.boolean().default(true),
          /** 群里允许开摄像头（仍须是主人号 + 口令；不推荐） */
          allowGroup: z.boolean().default(false),
        })
        .default({}),
      /**
       * 轻量知识库：把 md/txt/pdf 放进 data/knowledge/inbox →「知识入库」，
       * 聊天时关键词检索切片注入（不接 Embedding）。
       */
      knowledge: z
        .object({
          enabled: z.boolean().default(true),
          /** Relative to repo root, or absolute. */
          dir: z.string().default("data/knowledge"),
          chunkChars: z.number().int().positive().default(450),
          chunkOverlap: z.number().int().nonnegative().default(60),
          topK: z.number().int().positive().default(4),
          injectCharLimit: z.number().int().positive().default(900),
          minScore: z.number().min(0).max(1).default(0.18),
          /** Auto-inject retrieved chunks into normal chat turns. */
          injectOnChat: z.boolean().default(true),
        })
        .default({}),
      /**
       * L1+L2 自主：白名单工具 + 配额 + 定时决策 tick。
       * 开启后接管群冷场主动发言（经典 presence probe 会跳过，避免双开）。
       * 可主动私聊主人；空间只允许草稿，不直发。管理员可「闭嘴」。
       */
      autonomy: z
        .object({
          enabled: z.boolean().default(false),
          tickMs: z.number().int().positive().default(60_000),
          /** Group must be idle this long before she may act. */
          minGroupIdleMs: z.number().int().positive().default(4 * 60 * 1000),
          maxPerHour: z.number().int().nonnegative().default(6),
          maxPrivatePerHour: z.number().int().nonnegative().default(4),
          /** Local quiet window [start, end); wraps midnight. Default 1–8. */
          quietStartHour: z.number().int().min(0).max(23).default(1),
          quietEndHour: z.number().int().min(0).max(23).default(8),
          /** Allow proactive private messages (owner-only when privateOwnerOnly). */
          allowPrivate: z.boolean().default(true),
          /** Only owner QQ (admins[0], fallback constant) for private autonomy. */
          privateOwnerOnly: z.boolean().default(true),
          /**
           * Min gap since last owner private human msg OR last autonomous private act
           * before she may DM again.
           */
          minPrivateIdleMs: z.number().int().positive().default(30 * 60 * 1000),
          /** Decision bias: high = act when idle enough; low = prefer noop. */
          assertiveness: z.enum(["low", "normal", "high"]).default("high"),
          tools: z
            .object({
              sendText: z.boolean().default(true),
              sendSticker: z.boolean().default(true),
              /** Requires social.tts.enabled. Default off. */
              sendVoice: z.boolean().default(false),
              scheduleNudge: z.boolean().default(true),
              draftQzone: z.boolean().default(true),
            })
            .default({}),
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
