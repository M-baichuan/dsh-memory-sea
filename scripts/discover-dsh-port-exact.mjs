#!/usr/bin/env node
/**
 * 精确定位 DeepSeek Harness 桌面端当前 web 端口，并自动回填 config.json 的 dsh.baseUrl。
 *
 * 判据（逐层收敛，避免误判）：
 *  1) netstat: 仅 127.0.0.1 LISTENING
 *  2) PID -> 进程名 == "deepseek harness"（排除 SnowLuma / 其他 node）
 *  3) 用 bridge 铸造 cookie 后调 unary RPC "settings/describe"：
 *     真 DSH web 端口返回 ok=true；browser-agent 桥等返回 gateway/bad-response。
 * 只有通过 3) 的端口才会被写入 config.json。
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfgPath = path.join(root, "config.json");

function exec(cmd) {
  try { return execSync(cmd, { encoding: "utf8", windowsHide: true }); } catch { return ""; }
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

async function isDshWebPort(DshApiClient, port) {
  try {
    const cli = new DshApiClient({ baseUrl: `http://127.0.0.1:${port}` });
    const r = await cli.callUnary("settings/describe", null);
    return r && r.ok === true;
  } catch {
    return false;
  }
}

async function main() {
  const { DshApiClient } = await import(pathToFileURL(path.join(root, "packages/bridge/dist/dsh/api-client.js")).href);

  const rows = listenPorts();
  const byPid = new Map();
  for (const r of rows) {
    if (!byPid.has(r.pid)) byPid.set(r.pid, []);
    byPid.get(r.pid).push(r.port);
  }

  const candidates = [];
  for (const [pid, ports] of byPid) {
    if (procName(pid).includes("deepseek harness")) {
      for (const p of ports) candidates.push({ port: p, pid });
    }
  }
  if (candidates.length === 0) {
    console.error("[discover] 未找到 DeepSeek Harness.exe 监听端口，桌面端是否在运行？");
    process.exit(1);
  }

  let chosen = null;
  for (const c of candidates) {
    if (await isDshWebPort(DshApiClient, c.port)) { chosen = c; break; }
  }
  if (!chosen) {
    console.error(
      "[discover] 找到 DeepSeek Harness.exe 端口但均非 web RPC：",
      candidates.map((c) => c.port).join(", "),
      "（桌面端 web 是否已就绪？）",
    );
    process.exit(1);
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

main().catch((e) => { console.error("[discover] failed:", e); process.exit(1); });
