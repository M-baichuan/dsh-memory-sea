#!/usr/bin/env node
/**
 * 精确定位 DeepSeek Harness 桌面端当前 web 端口，并自动回填 config.json 的 dsh.baseUrl。
 *
 * 判据：
 *  1) netstat: 仅 127.0.0.1 LISTENING
 *  2) PID -> 进程名含 "deepseek harness"
 *  3) unary RPC settings/describe：ok=true 为真 web；gateway/bad-response 排除
 *
 * 找不到可用端口时：警告并 exit 0（保留现有 baseUrl，仍启动 bridge）。
 * 避免 process.exit(1) 在 Windows 上撞 UV_HANDLE_CLOSING 断言崩溃。
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfgPath = path.join(root, "config.json");

function exec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", windowsHide: true });
  } catch {
    return "";
  }
}

function listenPorts() {
  const out = exec("netstat -ano -p tcp");
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
    if (m) rows.push({ port: Number(m[1]), pid: Number(m[2]) });
  }
  return rows;
}

function procName(pid) {
  const out = exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
  const m = out.match(/^"([^"]+)"/m);
  return m ? m[1].toLowerCase() : "";
}

async function probePort(DshApiClient, port) {
  try {
    const cli = new DshApiClient({
      baseUrl: `http://127.0.0.1:${port}`,
      autoMintCookie: true,
    });
    cli.refreshAuth();
    const r = await cli.callUnary("settings/describe", null);
    if (r?.ok === true) return "ok";
    const code = r?.error?.code || "";
    if (code === "gateway/bad-response" || code === "gateway/not-found") return "reject";
    // Host answered an RPC envelope (cookie accepted) — treat as candidate.
    if (r && typeof r === "object" && ("ok" in r || "error" in r)) return "maybe";
    return "reject";
  } catch {
    return "reject";
  }
}

async function pickPort(DshApiClient, candidates, rounds = 3) {
  for (let round = 0; round < rounds; round++) {
    const maybes = [];
    for (const c of candidates) {
      const kind = await probePort(DshApiClient, c.port);
      if (kind === "ok") return c;
      if (kind === "maybe") maybes.push(c);
    }
    if (maybes.length === 1) return maybes[0];
    if (round < rounds - 1) {
      await new Promise((r) => setTimeout(r, 800));
    } else if (maybes.length) {
      return maybes[0];
    }
  }
  return null;
}

async function main() {
  const { DshApiClient } = await import(
    pathToFileURL(path.join(root, "packages/bridge/dist/dsh/api-client.js")).href
  );

  const rows = listenPorts();
  const byPid = new Map();
  for (const r of rows) {
    if (!byPid.has(r.pid)) byPid.set(r.pid, []);
    byPid.get(r.pid).push(r.port);
  }

  const candidates = [];
  for (const [pid, ports] of byPid) {
    if (procName(pid).includes("deepseek harness")) {
      // Prefer higher ports first (web RPC often 5xxxx); keep stable order within pid.
      const sorted = [...ports].sort((a, b) => b - a);
      for (const p of sorted) candidates.push({ port: p, pid });
    }
  }

  if (candidates.length === 0) {
    console.warn("[discover] 未找到 DeepSeek Harness.exe 监听端口，桌面端是否在运行？保留现有 dsh.baseUrl。");
    return;
  }

  const chosen = await pickPort(DshApiClient, candidates);
  if (!chosen) {
    console.warn(
      "[discover] 找到端口但暂未确认 web RPC：",
      candidates.map((c) => c.port).join(", "),
      "— 保留现有 dsh.baseUrl，继续启动 bridge。",
    );
    return;
  }

  const base = `http://127.0.0.1:${chosen.port}`;
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const prev = cfg.dsh?.baseUrl;
  if (!cfg.dsh) cfg.dsh = {};
  cfg.dsh.baseUrl = base;
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");

  console.log(`[discover] DSH web port = ${chosen.port} (pid ${chosen.pid})`);
  console.log(`[discover] config.json dsh.baseUrl: ${prev} -> ${base}`);
}

main()
  .catch((e) => {
    console.warn("[discover] failed:", e instanceof Error ? e.message : e);
  })
  .finally(() => {
    // Let undici sockets settle; avoid Windows UV_HANDLE_CLOSING abort.
    setTimeout(() => process.exit(0), 50);
  });
