import type { AppConfig } from "@dsh-memory-sea/shared";
import type { OneBotClient } from "../onebot/client.js";
import { sendImage, sendPlain, sendRecord } from "../onebot/send.js";
import {
  findSticker,
  listStickers,
  parseStickerTags,
  readStickerBase64,
  type StickerEntry,
} from "../social/stickers.js";
import { synthesizeVoiceBase64 } from "../social/tts.js";
import {
  bubbleGapMs,
  splitBubbles,
  sleep,
  typingDelayMs,
  type BubbleTiming,
} from "./bubbles.js";

export type TtsReplyMode = "ask" | "tag" | "always" | "voice_only";

export interface DeliverOptions {
  userId: string;
  groupId?: string;
  text: string;
  chunkLimit: number;
  replyToMessageId?: string | number;
  atSender?: boolean;
  stickerDir?: string;
  stickers?: StickerEntry[];
  social?: AppConfig["social"];
  /** Hot-switched edge-tts voice settings. */
  voiceRef?: { current: { edge: string; rate: string; pitch: string } };
  /** User asked for voice this turn (replyMode=ask). */
  preferVoice?: boolean;
}

function spokenFromBubbles(bubbles: string[]): string[] {
  const spoken = bubbles
    .join("，")
    .replace(/\s+/g, " ")
    .replace(/[|｜]{2,}/g, "，")
    .trim();
  if (!spoken) return [];
  return [spoken.slice(0, 120)];
}

function collectSpeakLines(
  voiceLines: string[],
  bubbles: string[],
  mode: TtsReplyMode,
  preferVoice: boolean,
): string[] {
  if (voiceLines.length) return voiceLines.map((l) => l.slice(0, 120));
  if (mode === "tag") return [];
  if (mode === "ask") {
    return preferVoice ? spokenFromBubbles(bubbles) : [];
  }
  // always | voice_only
  return spokenFromBubbles(bubbles);
}

/** Admin / system notices: one plain message, no bubble split, no TTS. */
export async function deliverNotice(
  client: OneBotClient,
  opts: {
    userId: string;
    groupId?: string;
    text: string;
    chunkLimit?: number;
  },
): Promise<void> {
  const text = String(opts.text ?? "").trim();
  if (!text) return;
  await sendPlain(client, {
    userId: opts.userId,
    groupId: opts.groupId,
    text,
    chunkLimit: Math.max(opts.chunkLimit ?? 400, 2000),
  });
}

export async function deliverReply(
  client: OneBotClient,
  opts: DeliverOptions,
): Promise<void> {
  const { text, stickerIds, voiceLines } = parseStickerTags(opts.text);
  const social = opts.social;
  const tts = social?.tts;
  const ttsReady = Boolean(tts?.enabled && tts.httpUrl?.trim());
  const replyMode = (tts?.replyMode ?? "ask") as TtsReplyMode;
  const preferVoice = Boolean(opts.preferVoice);
  // 用户点名要语音时：只发语音，不再发文字（表情仍可发）。
  const voiceOnlyTurn =
    replyMode === "voice_only" || (preferVoice && (replyMode === "ask" || replyMode === "always"));
  const sendText = !voiceOnlyTurn;

  const timing: BubbleTiming = {
    multiBubble: social?.multiBubble !== false,
    bubbleGapMinMs: social?.bubbleGapMinMs ?? 800,
    bubbleGapMaxMs: social?.bubbleGapMaxMs ?? 2000,
    typingDelay: social?.typingDelay !== false,
    typingMsPerChar: social?.typingMsPerChar ?? 30,
    typingMinMs: social?.typingMinMs ?? 400,
    typingMaxMs: social?.typingMaxMs ?? 2500,
  };

  const bubbles = splitBubbles(text, timing.multiBubble);

  if (sendText) {
    for (let i = 0; i < bubbles.length; i++) {
      const bubble = bubbles[i]!;
      await sleep(typingDelayMs(bubble, timing));
      await sendPlain(client, {
        userId: opts.userId,
        groupId: opts.groupId,
        text: bubble,
        chunkLimit: opts.chunkLimit,
        replyToMessageId: undefined,
        atUserId: i === 0 && opts.atSender && opts.groupId ? opts.userId : undefined,
      });
      if (i < bubbles.length - 1) await sleep(bubbleGapMs(timing));
    }
  } else if (opts.atSender && opts.groupId && bubbles.length) {
    await sendPlain(client, {
      userId: opts.userId,
      groupId: opts.groupId,
      text: " ",
      chunkLimit: opts.chunkLimit,
      atUserId: opts.userId,
    });
  }

  const entries =
    opts.stickers ??
    (opts.stickerDir ? listStickers(opts.stickerDir) : []);
  for (const id of stickerIds) {
    const entry = findSticker(entries, id);
    if (!entry) {
      console.warn(`[bridge] sticker not found: ${id}`);
      continue;
    }
    try {
      await sleep(bubbleGapMs(timing));
      await sendImage(client, {
        userId: opts.userId,
        groupId: opts.groupId,
        base64: readStickerBase64(entry),
      });
    } catch (err) {
      console.warn(
        `[bridge] sticker send failed (${id}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const speakLines = collectSpeakLines(voiceLines, bubbles, replyMode, preferVoice);

  if (speakLines.length && ttsReady) {
    for (const line of speakLines) {
      const vs = opts.voiceRef?.current;
      const b64 = await synthesizeVoiceBase64(line, tts!.httpUrl, {
        voice: vs?.edge || tts!.voice,
        rate: vs?.rate,
        pitch: vs?.pitch,
      });
      if (!b64) {
        console.warn(`[bridge] tts failed for: ${line.slice(0, 40)}`);
        if (!sendText) {
          await sendPlain(client, {
            userId: opts.userId,
            groupId: opts.groupId,
            text: line,
            chunkLimit: opts.chunkLimit,
          });
        }
        continue;
      }
      try {
        await sleep(bubbleGapMs(timing));
        await sendRecord(client, {
          userId: opts.userId,
          groupId: opts.groupId,
          base64: b64,
        });
      } catch (err) {
        console.warn(
          `[bridge] voice send failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  } else if (voiceLines.length && !ttsReady) {
    const aside = voiceLines.map((l) => `（语音）${l}`).join("\n");
    await sleep(typingDelayMs(aside, timing));
    await sendPlain(client, {
      userId: opts.userId,
      groupId: opts.groupId,
      text: aside,
      chunkLimit: opts.chunkLimit,
    });
  } else if (
    !ttsReady &&
    preferVoice &&
    bubbles.length &&
    (replyMode === "ask" || replyMode === "always" || replyMode === "voice_only")
  ) {
    console.warn("[bridge] voice requested but TTS not ready — fallback text");
    const fallback = spokenFromBubbles(bubbles)[0] || bubbles.join("\n");
    await sendPlain(client, {
      userId: opts.userId,
      groupId: opts.groupId,
      text: fallback,
      chunkLimit: opts.chunkLimit,
      atUserId: opts.atSender && opts.groupId ? opts.userId : undefined,
    });
  }
}
