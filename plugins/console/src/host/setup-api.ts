import { spawn } from "node:child_process";
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseAppConfig } from "@dsh-memory-sea/shared";
import WebSocket from "ws";

const QQ_RE = /^\d{5,12}$/;
const TOKEN_MASK = "••••";

type Json = Record<string, unknown>;

function readRawConfig(root: string): Json {
  const p = path.join(root, "config.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Json;
  } catch (err) {
    throw new Error(`config.json 无法解析: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function maskToken(token: unknown): string {
  const t = String(token ?? "");
  return t ? TOKEN_MASK : "";
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function bridgeStatus(root: string): { running: boolean; pid?: number } {
  const lockPath = path.join(root, "data/state/bridge.lock");
  if (!existsSync(lockPath)) return { running: false };
  try {
    const raw = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number };
    const pid = Number(raw.pid);
    if (pid && isPidAlive(pid)) return { running: true, pid };
  } catch {
    // ignore corrupt lock
  }
  return { running: false };
}

function pluginInstallStatus(root: string): {
  memoryTools: boolean;
  whalePreset: boolean;
  detail: string;
} {
  const memoryTools = existsSync(path.join(root, "plugins/memory-tools/package.json"));
  const whalePreset = existsSync(path.join(root, "plugins/whale-preset/package.json"));
  const parts: string[] = [];
  parts.push(memoryTools ? "memory-tools 包存在" : "memory-tools 包缺失");
  parts.push(whalePreset ? "whale-preset 包存在" : "whale-preset 包缺失");
  parts.push("正式安装请走 bootstrap → setup-dsh-plugins.mjs");
  return { memoryTools, whalePreset, detail: parts.join("；") };
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function ensureObj(parent: Json, key: string): Json {
  const cur = parent[key];
  if (cur && typeof cur === "object" && !Array.isArray(cur)) return cur as Json;
  const next: Json = {};
  parent[key] = next;
  return next;
}

function tcpReachable(host: string, port: number, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok: boolean) => {
      sock.removeAllListeners();
      sock.destroy();
      resolve(ok);
    };
    const t = setTimeout(() => done(false), ms);
    sock.once("connect", () => {
      clearTimeout(t);
      done(true);
    });
    sock.once("error", () => {
      clearTimeout(t);
      done(false);
    });
  });
}

function wsReachable(wsUrl: string, ms: number): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket;
    const finish = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve({ ok, detail });
    };
    try {
      ws = new WebSocket(wsUrl, { handshakeTimeout: ms });
    } catch (err) {
      resolve({ ok: false, detail: err instanceof Error ? err.message : String(err) });
      return;
    }
    const timer = setTimeout(() => finish(false, "WebSocket 连接超时（2s）"), ms);
    ws.once("open", () => finish(true, "WebSocket 已连接"));
    ws.once("error", (err) => finish(false, err.message || "WebSocket 错误"));
  });
}

async function probeDshDescribe(
  root: string,
  baseUrl: string,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const mod = await import(
      pathToFileURL(path.join(root, "packages/bridge/dist/dsh/api-client.js")).href
    );
    const DshApiClient = (
      mod as {
        DshApiClient: new (o: { baseUrl: string; autoMintCookie?: boolean }) => {
          refreshAuth: () => unknown;
          callUnary: (
            m: string,
            b: null,
          ) => Promise<{ ok?: boolean; error?: { code?: string } }>;
        };
      }
    ).DshApiClient;
    const cli = new DshApiClient({ baseUrl, autoMintCookie: true });
    cli.refreshAuth();
    const r = await Promise.race([
      cli.callUnary("settings/describe", null),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("settings/describe 超时（3s）")), 3000),
      ),
    ]);
    if (r?.ok === true) return { ok: true, detail: "settings/describe ok" };
    const code = r?.error?.code || "";
    if (code === "gateway/bad-response" || code === "gateway/not-found") {
      return { ok: false, detail: `DSH 拒绝 RPC: ${code}` };
    }
    if (r && typeof r === "object" && ("ok" in r || "error" in r)) {
      return { ok: true, detail: "DSH 已应答 RPC 信封" };
    }
    return { ok: false, detail: "settings/describe 无有效响应" };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

function checkDirWritable(dir: string): { ok: boolean; detail: string } {
  const trimmed = dir.trim();
  if (!trimmed) return { ok: false, detail: "工作区路径为空" };
  try {
    mkdirSync(trimmed, { recursive: true });
    if (!statSync(trimmed).isDirectory()) {
      return { ok: false, detail: "路径存在但不是目录" };
    }
    accessSync(trimmed, constants.W_OK);
    const probe = path.join(trimmed, `.setup-write-probe-${process.pid}`);
    writeFileSync(probe, "ok", "utf8");
    unlinkSync(probe);
    return { ok: true, detail: "目录存在且可写" };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function handleSetupState(root: string): Promise<unknown> {
  const raw = readRawConfig(root);
  const cfg = parseAppConfig(raw);
  const onebot = (raw.onebot && typeof raw.onebot === "object" ? raw.onebot : {}) as Json;
  const dsh = (raw.dsh && typeof raw.dsh === "object" ? raw.dsh : {}) as Json;
  const access = (raw.access && typeof raw.access === "object" ? raw.access : {}) as Json;
  const persona = (raw.persona && typeof raw.persona === "object" ? raw.persona : {}) as Json;
  const bridge = bridgeStatus(root);
  return {
    config: {
      onebot: {
        selfId: String(onebot.selfId ?? cfg.onebot.selfId ?? ""),
        wsUrl: String(onebot.wsUrl ?? cfg.onebot.wsUrl ?? "ws://127.0.0.1:3001"),
        httpUrl: String(onebot.httpUrl ?? cfg.onebot.httpUrl ?? "http://127.0.0.1:3000"),
        accessToken: maskToken(onebot.accessToken ?? cfg.onebot.accessToken),
        accessTokenSet: Boolean(String(onebot.accessToken ?? cfg.onebot.accessToken ?? "")),
      },
      access: {
        admins: Array.isArray(access.admins) ? access.admins.map(String) : cfg.access.admins,
        allowUsers: Array.isArray(access.allowUsers)
          ? access.allowUsers.map(String)
          : cfg.access.allowUsers,
      },
      persona: {
        ownerTitle: String(persona.ownerTitle ?? cfg.persona.ownerTitle ?? "主人"),
      },
      dsh: {
        baseUrl: String(dsh.baseUrl ?? cfg.dsh.baseUrl ?? ""),
        workspaceRoot: String(dsh.workspaceRoot ?? cfg.dsh.workspaceRoot ?? ""),
        workspaceGroup: String(dsh.workspaceGroup ?? cfg.dsh.workspaceGroup ?? ""),
      },
    },
    discover: {
      baseUrl: String(dsh.baseUrl ?? cfg.dsh.baseUrl ?? ""),
      note: "点击「重新发现」会跑 scripts/discover-dsh-port-exact.mjs",
    },
    plugins: pluginInstallStatus(root),
    bridge: {
      ...bridge,
      hint: bridge.running ? null : "bridge 未运行。请在项目根目录执行：pnpm bridge",
    },
  };
}

type ValidateBody = {
  fields?: string[];
  selfId?: string;
  ownerQq?: string;
  ownerTitle?: string;
  wsUrl?: string;
  httpUrl?: string;
  accessToken?: string;
  baseUrl?: string;
  workspaceRoot?: string;
};

export async function handleSetupValidate(
  root: string,
  body: ValidateBody,
): Promise<{ ok: boolean; results: Record<string, { ok: boolean; detail: string }> }> {
  const fields = new Set(
    (
      body.fields?.length
        ? body.fields
        : ["selfId", "ownerQq", "ownerTitle", "wsUrl", "workspaceRoot", "baseUrl"]
    ).map(String),
  );
  const results: Record<string, { ok: boolean; detail: string }> = {};

  if (fields.has("selfId")) {
    const v = String(body.selfId ?? "").trim();
    results.selfId = QQ_RE.test(v)
      ? { ok: true, detail: "机器人 QQ 格式正确" }
      : { ok: false, detail: "机器人 QQ 号须为 5–12 位纯数字" };
  }
  if (fields.has("ownerQq")) {
    const v = String(body.ownerQq ?? "").trim();
    results.ownerQq = QQ_RE.test(v)
      ? { ok: true, detail: "主人 QQ 格式正确" }
      : { ok: false, detail: "主人 QQ 号须为 5–12 位纯数字" };
  }
  if (fields.has("ownerTitle")) {
    const v = String(body.ownerTitle ?? "主人").trim() || "主人";
    results.ownerTitle =
      v.length <= 32
        ? { ok: true, detail: `称呼「${v}」` }
        : { ok: false, detail: "称呼过长（≤32）" };
  }
  if (fields.has("wsUrl")) {
    const wsUrl = String(body.wsUrl ?? "").trim() || "ws://127.0.0.1:3001";
    try {
      const u = new URL(wsUrl);
      if (u.protocol !== "ws:" && u.protocol !== "wss:") {
        results.wsUrl = { ok: false, detail: "wsUrl 须以 ws:// 或 wss:// 开头" };
      } else {
        results.wsUrl = await wsReachable(wsUrl, 2000);
      }
    } catch (err) {
      results.wsUrl = {
        ok: false,
        detail: err instanceof Error ? err.message : "wsUrl 无效",
      };
    }
  }
  if (fields.has("httpUrl")) {
    const httpUrl = String(body.httpUrl ?? "").trim() || "http://127.0.0.1:3000";
    try {
      const u = new URL(httpUrl);
      const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
      const ok = await tcpReachable(u.hostname, port, 2000);
      results.httpUrl = ok
        ? { ok: true, detail: "HTTP 端口可达" }
        : { ok: false, detail: "HTTP 端口 2s 内不可达" };
    } catch (err) {
      results.httpUrl = {
        ok: false,
        detail: err instanceof Error ? err.message : "httpUrl 无效",
      };
    }
  }
  if (fields.has("workspaceRoot")) {
    const wr = String(body.workspaceRoot ?? "").trim();
    results.workspaceRoot = wr
      ? checkDirWritable(wr)
      : { ok: true, detail: "空 = 默认 <repo>/data/agents" };
  }
  if (fields.has("baseUrl")) {
    const baseUrl = String(body.baseUrl ?? "").trim();
    if (!baseUrl) {
      results.baseUrl = { ok: false, detail: "dsh.baseUrl 为空，请先发现端口" };
    } else {
      results.baseUrl = await probeDshDescribe(root, baseUrl);
    }
  }

  const ok = Object.values(results).every((r) => r.ok);
  return { ok, results };
}

type ApplyBody = {
  selfId?: string;
  ownerQq?: string;
  ownerTitle?: string;
  wsUrl?: string;
  httpUrl?: string;
  accessToken?: string;
  baseUrl?: string;
  workspaceRoot?: string;
};

export async function handleSetupApply(
  root: string,
  body: ApplyBody,
): Promise<{
  ok: boolean;
  error?: string;
  backup?: string;
  diff?: Record<string, { from: unknown; to: unknown }>;
  results?: Record<string, { ok: boolean; detail: string }>;
}> {
  const validation = await handleSetupValidate(root, {
    fields: ["selfId", "ownerQq", "ownerTitle", "workspaceRoot"],
    selfId: body.selfId,
    ownerQq: body.ownerQq,
    ownerTitle: body.ownerTitle,
    workspaceRoot: body.workspaceRoot,
  });
  const hardKeys = ["selfId", "ownerQq", "ownerTitle", "workspaceRoot"] as const;
  const hardFail = hardKeys.some((k) => validation.results[k] && !validation.results[k]!.ok);
  if (hardFail) {
    return {
      ok: false,
      error: "校验失败，未写入 config.json",
      results: validation.results,
    };
  }

  const cfgPath = path.join(root, "config.json");
  const raw = readRawConfig(root);
  const before = structuredClone(raw);

  const onebot = ensureObj(raw, "onebot");
  const access = ensureObj(raw, "access");
  const persona = ensureObj(raw, "persona");
  const dsh = ensureObj(raw, "dsh");

  const selfId = String(body.selfId ?? "").trim();
  const ownerQq = String(body.ownerQq ?? "").trim();
  const ownerTitle = String(body.ownerTitle ?? "主人").trim() || "主人";
  const wsUrl = String(body.wsUrl ?? "").trim() || "ws://127.0.0.1:3001";
  const httpUrl = String(body.httpUrl ?? "").trim() || "http://127.0.0.1:3000";
  const tokenIn = String(body.accessToken ?? "");
  const baseUrl = String(body.baseUrl ?? "").trim();
  const workspaceRoot = String(body.workspaceRoot ?? "").trim();

  onebot.selfId = selfId;
  onebot.wsUrl = wsUrl;
  onebot.httpUrl = httpUrl;
  if (tokenIn && tokenIn !== TOKEN_MASK && !/^•+$/.test(tokenIn)) {
    onebot.accessToken = tokenIn;
  }

  const admins = Array.isArray(access.admins) ? access.admins.map(String) : [];
  const allowUsers = Array.isArray(access.allowUsers) ? access.allowUsers.map(String) : [];
  if (admins.length === 0) admins.push(ownerQq);
  else admins[0] = ownerQq;
  if (!allowUsers.includes(ownerQq)) allowUsers.push(ownerQq);
  access.admins = admins;
  access.allowUsers = allowUsers;

  persona.ownerTitle = ownerTitle;
  if (baseUrl) dsh.baseUrl = baseUrl;
  dsh.workspaceRoot = workspaceRoot;

  try {
    parseAppConfig(raw);
  } catch (err) {
    return {
      ok: false,
      error: `zod 校验失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const bak = `${cfgPath}.bak-${stamp()}`;
  if (existsSync(cfgPath)) {
    copyFileSync(cfgPath, bak);
  }

  try {
    writeFileSync(cfgPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    parseAppConfig(JSON.parse(readFileSync(cfgPath, "utf8")) as unknown);
  } catch (err) {
    if (existsSync(bak)) {
      copyFileSync(bak, cfgPath);
    }
    return {
      ok: false,
      error: `写入失败已回滚: ${err instanceof Error ? err.message : String(err)}`,
      backup: existsSync(bak) ? path.basename(bak) : undefined,
    };
  }

  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const track = (key: string, from: unknown, to: unknown) => {
    if (JSON.stringify(from) !== JSON.stringify(to)) diff[key] = { from, to };
  };
  const bOne = (before.onebot && typeof before.onebot === "object" ? before.onebot : {}) as Json;
  const bAcc = (before.access && typeof before.access === "object" ? before.access : {}) as Json;
  const bPer = (before.persona && typeof before.persona === "object" ? before.persona : {}) as Json;
  const bDsh = (before.dsh && typeof before.dsh === "object" ? before.dsh : {}) as Json;
  track("onebot.selfId", bOne.selfId ?? "", onebot.selfId);
  track("onebot.wsUrl", bOne.wsUrl ?? "", onebot.wsUrl);
  track("onebot.httpUrl", bOne.httpUrl ?? "", onebot.httpUrl);
  if (tokenIn && tokenIn !== TOKEN_MASK && !/^•+$/.test(tokenIn)) {
    track("onebot.accessToken", maskToken(bOne.accessToken), TOKEN_MASK);
  }
  track("access.admins[0]", Array.isArray(bAcc.admins) ? bAcc.admins[0] : "", ownerQq);
  track("access.allowUsers", bAcc.allowUsers ?? [], access.allowUsers);
  track("persona.ownerTitle", bPer.ownerTitle ?? "", ownerTitle);
  track("dsh.baseUrl", bDsh.baseUrl ?? "", dsh.baseUrl);
  track("dsh.workspaceRoot", bDsh.workspaceRoot ?? "", workspaceRoot);

  return {
    ok: true,
    backup: path.basename(bak),
    diff,
    results: validation.results,
  };
}

export function handleSetupBootstrap(
  root: string,
  res: http.ServerResponse,
  steps?: string[],
): void {
  const want = new Set(
    (steps?.length ? steps : ["plugins", "discover"]).map((s) => String(s)),
  );
  res.writeHead(200, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-cache",
    "x-accel-buffering": "no",
  });

  const bridge = bridgeStatus(root);
  if (!bridge.running) {
    res.write("[bootstrap] bridge 未运行。配置写入后请自行执行：pnpm bridge\n");
  } else {
    res.write(`[bootstrap] bridge 已在运行 (pid ${bridge.pid})\n`);
  }

  const queue: Array<{ label: string; script: string; args: string[] }> = [];
  if (want.has("plugins")) {
    queue.push({
      label: "setup-dsh-plugins",
      script: path.join(root, "scripts/setup-dsh-plugins.mjs"),
      args: ["desktop"],
    });
  }
  if (want.has("discover")) {
    queue.push({
      label: "discover-dsh-port",
      script: path.join(root, "scripts/discover-dsh-port-exact.mjs"),
      args: [],
    });
  }

  const runNext = (i: number) => {
    if (i >= queue.length) {
      res.write("[bootstrap] done\n");
      res.end();
      return;
    }
    const job = queue[i]!;
    res.write(`\n[bootstrap] >>> ${job.label}\n`);
    const child = spawn(process.execPath, [job.script, ...job.args], {
      cwd: root,
      env: process.env,
      windowsHide: true,
    });
    child.stdout?.on("data", (buf: Buffer) => {
      res.write(buf);
    });
    child.stderr?.on("data", (buf: Buffer) => {
      res.write(buf);
    });
    child.on("error", (err) => {
      res.write(`[bootstrap] ${job.label} spawn error: ${err.message}\n`);
      runNext(i + 1);
    });
    child.on("close", (code) => {
      res.write(`[bootstrap] ${job.label} exit=${code ?? "?"}\n`);
      runNext(i + 1);
    });
  };

  runNext(0);
}
