import { randomUUID } from "node:crypto";
import WebSocket from "ws";

export interface TurnWaitOptions {
  baseUrl: string;
  cookie: string;
  sessionId: string;
  /** Max time to wait for turn/end after prompt accepted. */
  timeoutMs?: number;
}

/**
 * Open /api/remote.mux, follow one session, collect assistant text until turn/end.
 * Snapshot history is ignored (maxMessages=0) so we only take the live turn.
 */
export async function waitForAssistantTurn(opts: TurnWaitOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 180_000;
  const url = new URL("/api/remote.mux", opts.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let text = "";
    let sawTurnStart = false;
    const streamId = randomUUID();
    const socket = new WebSocket(url, { headers: { cookie: opts.cookie } });

    const finish = (err?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(value ?? "");
    };

    const timer = setTimeout(() => {
      finish(new Error(`waitForAssistantTurn timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "open",
          streamId,
          endpoint: "session/follow",
          payload: {
            args: {
              request: {
                address: { kind: "session", sessionId: opts.sessionId },
                // Host gateway requires a positive integer; 0 is rejected
                // ("maxMessages must be a positive safe integer"). 1 is the
                // minimum that keeps follow-stream live-turn-only.
                maxMessages: 1,
              },
            },
          },
        }),
      );
    });

    socket.on("message", (raw) => {
      let msg: {
        type?: string;
        streamId?: string;
        value?: {
          type?: string;
          event?: {
            type?: string;
            data?: {
              turn?: number;
              message?: { content?: Array<{ type?: string; text?: string }> };
            };
          };
        };
      };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.streamId !== streamId) return;
      if (msg.type === "error" || msg.type === "end") {
        if (!settled && sawTurnStart) finish(undefined, text);
        return;
      }
      // Live frames: { type:'item', value:{ type:'event', event:{ type, data } } }
      if (msg.type !== "item" || msg.value?.type !== "event") return;
      const inner = msg.value.event;
      const evType = inner?.type;
      const data = inner?.data;
      if (evType === "turn/start") {
        sawTurnStart = true;
        text = "";
        return;
      }
      if (evType === "assistant/message") {
        for (const block of data?.message?.content ?? []) {
          if (block?.type === "text" && typeof block.text === "string") text += block.text;
        }
        return;
      }
      if (evType === "turn/end") {
        finish(undefined, text);
      }
    });

    socket.on("error", (err) => finish(err instanceof Error ? err : new Error(String(err))));
    socket.on("close", () => {
      if (!settled) {
        if (sawTurnStart) finish(undefined, text);
        else finish(new Error("remote.mux closed before turn/end"));
      }
    });
  });
}
