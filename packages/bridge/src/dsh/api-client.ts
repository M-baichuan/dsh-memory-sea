import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  discoverDshSessionCookie,
  isLoopbackBase,
  MINTED_COOKIE_LIFETIME_MS,
} from "./cookie.js";
import { buildClientRequest, unwrapRpc, type RpcResult } from "./rpc.js";
import { waitForAssistantTurn } from "./turn-wait.js";

export interface DshClientOptions {
  baseUrl: string;
  /** Manual Cookie override (name=value). Empty = auto-mint from ~/.dsh/.credentials.yaml */
  cookie?: string;
  /** When true (default), mint browser-session cookie for Desktop Host. */
  autoMintCookie?: boolean;
  /** Workspace title shown in Desktop (e.g. "QQ 聊天"). */
  workspaceTitle?: string;
  /** Agent cwd for new workspaces. Defaults to <cwd>/data/agents. */
  workspacePath?: string;
  /** Optional agent preset id (only when intentionally locking tools). */
  agentPreset?: string;
}

export interface PromptResult {
  text: string;
  sessionId: string;
}

/**
 * HTTP/WS adapter for DeepSeek Harness Host (Desktop or Web).
 * Desktop Host requires browser-session Cookie; we mint it locally like qq-bridge.
 * Speaks real DSH unary RPC (`/api/session/*`, `/api/workspace/*`) — not fictional plugin routes.
 */
export class DshApiClient {
  private cookie = "";
  private cookieExpiresAt = 0;
  private readonly autoMint: boolean;
  private workspaceId: string | null = null;

  constructor(private readonly options: DshClientOptions) {
    this.autoMint = options.autoMintCookie !== false;
    if (options.cookie?.trim()) {
      this.cookie = options.cookie.trim();
      this.cookieExpiresAt = Date.now() + MINTED_COOKIE_LIFETIME_MS;
    }
  }

  /** Ensure Cookie is present/fresh for Desktop Host (401 without it). */
  refreshAuth(): { ok: boolean; source: "manual" | "minted" | "none"; detail?: string } {
    if (this.options.cookie?.trim()) {
      this.cookie = this.options.cookie.trim();
      this.cookieExpiresAt = Date.now() + MINTED_COOKIE_LIFETIME_MS;
      return { ok: true, source: "manual" };
    }
    if (!this.autoMint) return { ok: false, source: "none", detail: "autoMintCookie=false" };
    if (!isLoopbackBase(this.options.baseUrl)) {
      return {
        ok: false,
        source: "none",
        detail: "refusing to mint cookie for non-loopback baseUrl",
      };
    }
    const minted = discoverDshSessionCookie(this.options.baseUrl);
    if (!minted) {
      return {
        ok: false,
        source: "none",
        detail: "missing ~/.dsh/.credentials.yaml browser-session secret",
      };
    }
    this.cookie = minted;
    this.cookieExpiresAt = Date.now() + MINTED_COOKIE_LIFETIME_MS - 5 * 60 * 1000;
    return { ok: true, source: "minted" };
  }

  private ensureCookie(): void {
    if (this.options.cookie?.trim()) {
      this.cookie = this.options.cookie.trim();
      return;
    }
    if (!this.autoMint) return;
    if (this.cookie && Date.now() < this.cookieExpiresAt) return;
    this.refreshAuth();
  }

  /**
   * Auth-aware health. Desktop often has no /api/healthz (404 after cookie).
   * Prefer a real unary RPC: some ports serve `/` without auth (false positive).
   */
  async health(): Promise<{ ok: boolean; status?: number; auth?: string }> {
    this.ensureCookie();
    try {
      const probe = async () => {
        const result = await this.callUnary("settings/describe", null);
        if (result.ok) return { ok: true, status: 200, auth: "ok" as const };
        if (result.error.code === "auth/unauthorized") {
          return { ok: false, status: 401, auth: "blocked" as const };
        }
        // Host answered RPC envelope — cookie accepted even if method failed.
        return { ok: true, status: 200, auth: "ok" as const };
      };

      let result = await probe();
      if (result.status === 401) {
        this.cookie = "";
        this.refreshAuth();
        result = await probe();
      }
      return result;
    } catch (err) {
      return { ok: false, auth: String(err) };
    }
  }

  async callUnary<T = unknown>(method: string, payload: unknown): Promise<RpcResult<T>> {
    this.ensureCookie();
    const message = buildClientRequest(method, payload);
    const res = await fetch(new URL(`/api/${message.method}`, this.options.baseUrl), {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(message),
    });
    if (res.status === 401) {
      this.cookie = "";
      this.refreshAuth();
      const retry = await fetch(new URL(`/api/${message.method}`, this.options.baseUrl), {
        method: "POST",
        headers: this.headers({ "content-type": "application/json" }),
        body: JSON.stringify(message),
      });
      if (retry.status === 401) {
        return {
          ok: false,
          error: { code: "auth/unauthorized", message: "Host cookie rejected (401)" },
        };
      }
      const full = (await retry.json()) as {
        type?: string;
        rpcId?: string;
        result?: RpcResult<T>;
      };
      if (!full?.result) {
        return {
          ok: false,
          error: { code: "gateway/bad-response", message: `invalid server-response for ${message.method}` },
        };
      }
      return full.result;
    }
    const full = (await res.json()) as {
      type?: string;
      rpcId?: string;
      result?: RpcResult<T>;
    };
    if (!full?.result) {
      return {
        ok: false,
        error: { code: "gateway/bad-response", message: `invalid server-response for ${message.method}` },
      };
    }
    return full.result;
  }

  private resolveWorkspacePath(): string {
    const dir =
      this.options.workspacePath?.trim() ||
      path.join(process.cwd(), "data", "agents");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private async ensureWorkspace(): Promise<string> {
    if (this.workspaceId) return this.workspaceId;
    const dir = this.resolveWorkspacePath();
    const created = unwrapRpc<{
      created?: boolean;
      workspace?: { workspaceId?: string };
      workspaceId?: string;
    }>(await this.callUnary("workspace/create", { path: dir }), "workspace/create");
    const id =
      created.workspace?.workspaceId ??
      created.workspaceId ??
      "";
    if (!id) throw new Error("workspace/create returned no workspaceId");
    this.workspaceId = id;
    const title = this.options.workspaceTitle?.trim();
    if (created.created && title) {
      try {
        await this.callUnary("workspace/rename", { workspaceId: id, title });
      } catch {
        /* rename is best-effort */
      }
    }
    return id;
  }

  async ensureSession(opts: {
    key: string;
    title: string;
    model?: string;
    provider?: string;
    systemPrompt?: string;
  }): Promise<string> {
    const workspaceId = await this.ensureWorkspace();
    const params: Record<string, unknown> = { workspaceId };
    if (this.options.agentPreset?.trim()) {
      params.agentPreset = this.options.agentPreset.trim();
    }
    const value = unwrapRpc<{ sessionId?: string }>(
      await this.callUnary("session/create", params),
      "session/create",
    );
    const sessionId = value.sessionId;
    if (!sessionId) throw new Error("session/create returned no sessionId");

    if (opts.title?.trim()) {
      try {
        await this.callUnary("session/rename", { sessionId, title: opts.title.trim() });
      } catch {
        /* best-effort */
      }
    }

    if (opts.model?.trim()) {
      try {
        await this.callUnary("session/selectModel", {
          sessionId,
          model: opts.model.trim(),
          provider: opts.provider?.trim() || undefined,
        });
      } catch (err) {
        console.warn("[bridge] selectModel skipped:", err instanceof Error ? err.message : err);
      }
    }

    void opts.key;
    void opts.systemPrompt;
    return sessionId;
  }

  async prompt(opts: {
    sessionId: string;
    message: string;
    systemPrompt?: string;
    /** Multimodal image parts for vision models (DSH content blocks). */
    images?: Array<{ mediaType: string; data: string; name?: string }>;
  }): Promise<PromptResult> {
    this.ensureCookie();
    if (opts.sessionId.startsWith("local:")) {
      return {
        sessionId: opts.sessionId,
        text:
          `（DSH 会话未真正创建）我收到了：${truncate(opts.message, 120)}\n` +
          `请确认桌面端 cookie 鉴权与 RPC 正常。`,
      };
    }

    // Follow before prompt so we don't miss turn/start.
    const waitPromise = waitForAssistantTurn({
      baseUrl: this.options.baseUrl,
      cookie: this.cookie,
      sessionId: opts.sessionId,
    });

    // Give mux a moment to open follow before enqueueing the turn.
    await new Promise((r) => setTimeout(r, 150));

    const content: Array<Record<string, unknown>> = [
      { type: "text", text: opts.message },
    ];
    for (const img of opts.images ?? []) {
      if (!img?.data) continue;
      content.push({
        type: "image",
        mediaType: img.mediaType || "image/jpeg",
        data: img.data,
        name: img.name || "image.jpg",
      });
    }

    const accepted = await this.callUnary<{
      command?: { text?: string };
    }>("session/prompt", {
      sessionId: opts.sessionId,
      mode: "queue",
      content,
    });

    if (!accepted.ok) {
      waitPromise.catch(() => undefined);
      if (accepted.error.code === "auth/unauthorized") {
        return {
          sessionId: opts.sessionId,
          text:
            "（DSH Host cookie 鉴权失败）请确认桌面端已启动，且本机存在 ~/.dsh/.credentials.yaml；" +
            "bridge 已尝试自动铸造 cookie。可在 config.json 设置 dsh.cookie 手动覆盖。",
        };
      }
      return {
        sessionId: opts.sessionId,
        text: `（DSH prompt 被拒）${accepted.error.code}: ${accepted.error.message}`,
      };
    }

    if (accepted.value?.command?.text) {
      waitPromise.catch(() => undefined);
      return { sessionId: opts.sessionId, text: accepted.value.command.text };
    }

    try {
      const text = await waitPromise;
      return { sessionId: opts.sessionId, text: text || "……" };
    } catch (err) {
      return {
        sessionId: opts.sessionId,
        text:
          `（DSH 回合等待失败）${err instanceof Error ? err.message : String(err)}\n` +
          `请确认桌面端仍在运行且端口与 config.json 的 dsh.baseUrl 一致。`,
      };
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.cookie) headers.cookie = this.cookie;
    return headers;
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
