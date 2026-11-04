import WebSocket from "ws";
import { EventEmitter } from "node:events";

export interface OneBotClientOptions {
  wsUrl: string;
  accessToken?: string;
  selfId?: string;
}

export interface OneBotEvent {
  post_type?: string;
  message_type?: string;
  notice_type?: string;
  sub_type?: string;
  user_id?: number | string;
  group_id?: number | string;
  target_id?: number | string;
  self_id?: number | string;
  message_id?: number | string;
  raw_message?: string;
  message?: unknown;
  sender?: { user_id?: number | string; nickname?: string };
}

export class OneBotClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private echo = 1;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(private readonly options: OneBotClientOptions) {
    super();
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    const headers: Record<string, string> = {};
    if (this.options.accessToken) {
      headers.Authorization = `Bearer ${this.options.accessToken}`;
    }
    const ws = new WebSocket(this.options.wsUrl, { headers });
    this.ws = ws;

    ws.on("open", () => this.emit("open"));
    ws.on("close", () => {
      this.emit("close");
      this.scheduleReconnect();
    });
    ws.on("error", (err) => this.emit("error", err));
    ws.on("message", (data) => this.onMessage(data.toString()));
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  private onMessage(raw: string): void {
    let payload: OneBotEvent & { echo?: string; status?: string; data?: unknown; retcode?: number };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      return;
    }

    if (payload.echo != null && this.pending.has(String(payload.echo))) {
      const p = this.pending.get(String(payload.echo))!;
      this.pending.delete(String(payload.echo));
      if (payload.status === "failed" || (payload.retcode != null && payload.retcode !== 0)) {
        p.reject(new Error(`OneBot API failed: ${raw}`));
      } else {
        p.resolve(payload.data);
      }
      return;
    }

    if (payload.post_type === "message") {
      this.emit("message", payload);
    } else {
      this.emit("event", payload);
    }
  }

  call(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("OneBot websocket not connected"));
    }
    const echo = String(this.echo++);
    const body = { action, params, echo };
    return new Promise((resolve, reject) => {
      this.pending.set(echo, { resolve, reject });
      this.ws!.send(JSON.stringify(body));
      setTimeout(() => {
        if (this.pending.has(echo)) {
          this.pending.delete(echo);
          reject(new Error(`OneBot call timeout: ${action}`));
        }
      }, 15000);
    });
  }
}
