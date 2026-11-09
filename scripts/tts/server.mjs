#!/usr/bin/env node
/**
 * Local TTS for Memory Sea bridge.
 * POST /tts  JSON { text, voice? } → { base64, format: "mp3" }
 * GET  /health → { ok: true, voice }
 */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TTS_PORT || 8787);
const HOST = process.env.TTS_HOST || "127.0.0.1";
const DEFAULT_VOICE = process.env.TTS_VOICE || "zh-CN-XiaoxiaoNeural";
const DEFAULT_RATE = process.env.TTS_RATE || "+0%";
const DEFAULT_PITCH = process.env.TTS_PITCH || "+0Hz";
const PYTHON = process.env.TTS_PYTHON || process.env.PYTHON || "python";
const SYNTH = path.join(__dirname, "synthesize.py");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `exit ${code}`));
    });
  });
}

async function synthesize(text, voice, rate, pitch) {
  const dir = await mkdtemp(path.join(tmpdir(), "sea-tts-"));
  const out = path.join(dir, "out.mp3");
  try {
    await run(PYTHON, [
      SYNTH,
      "--text",
      text,
      "--voice",
      voice,
      "--rate",
      rate,
      "--pitch",
      pitch,
      "--out",
      out,
    ]);
    const buf = await readFile(out);
    return buf;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    sendJson(res, 200, { ok: true, voice: DEFAULT_VOICE, port: PORT });
    return;
  }

  if (req.method === "POST" && (url.pathname === "/tts" || url.pathname === "/")) {
    try {
      const raw = await readBody(req);
      let payload = {};
      const ctype = req.headers["content-type"] || "";
      if (ctype.includes("application/json")) {
        payload = JSON.parse(raw.toString("utf8") || "{}");
      } else {
        payload = { text: raw.toString("utf8") };
      }
      const text = String(payload.text ?? "").trim();
      if (!text) {
        sendJson(res, 400, { error: "text required" });
        return;
      }
      const voice = String(payload.voice || DEFAULT_VOICE).trim() || DEFAULT_VOICE;
      const rate = String(payload.rate || DEFAULT_RATE);
      const pitch = String(payload.pitch || DEFAULT_PITCH);
      const mp3 = await synthesize(text, voice, rate, pitch);
      sendJson(res, 200, {
        base64: mp3.toString("base64"),
        format: "mp3",
        voice,
        bytes: mp3.length,
      });
    } catch (err) {
      console.error("[tts]", err instanceof Error ? err.message : err);
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`[tts] listening http://${HOST}:${PORT}/tts`);
  console.log(`[tts] voice=${DEFAULT_VOICE} python=${PYTHON}`);
  console.log(`[tts] health http://${HOST}:${PORT}/health`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
