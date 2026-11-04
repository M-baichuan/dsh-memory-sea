#!/usr/bin/env node
/**
 * Build a sanitized share zip into a temp output dir (no personal config/state/cache).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.DSH_SHARE_OUT || path.join(os.tmpdir(), "memory-sea-share");
const stamp = new Date()
  .toISOString()
  .replace(/[-:TZ.]/g, "")
  .slice(0, 12);
const zipName = `DSH-Memory-Sea-share-${stamp.slice(0, 8)}-${stamp.slice(8)}.zip`;
const destZip = path.join(outDir, zipName);
const stage = path.join(
  process.env.TEMP || process.env.TMP || "/tmp",
  `dsh-memory-sea-share-${stamp}`,
);

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".npm-cache",
  "coverage",
  ".vitest",
  ".cursor",
]);

/** Redact personal identifiers in text files when packing for others. */
const REDACTIONS = [
  [/10001/g, "10001"],
  [/20001/g, "20001"],
  [/10002/g, "10002"],
  [/ExampleNick/g, "ExampleNick"],
  [/YourUser/g, "YourUser"],
  [/YOUR_EYE_SECRET/g, "YOUR_EYE_SECRET"],
  [/D:\\\\memory_sea_project/g, "D:\\\\your_project"],
  [/D:\\your_project/g, "D:\\your_project"],
];

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".ps1",
  ".py",
  ".yml",
  ".yaml",
  ".html",
  ".css",
  ".toml",
]);

function shouldSkipFile(name) {
  if (name === "config.json") return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (name.endsWith(".log") || name.endsWith(".tsbuildinfo")) return true;
  return false;
}

function relIsStickerImage(abs) {
  const rel = path.relative(root, abs).replace(/\\/g, "/");
  if (!rel.startsWith("data/stickers/")) return false;
  return /\.(png|jpe?g|gif|webp)$/i.test(rel);
}

function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dst, name);
    const st = statSync(from);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      const rel = path.relative(root, from).replace(/\\/g, "/");
      // Never pack runtime personal data / caches / incoming chat media
      if (/^data\/(memory|state|keys|agents|cache)(\/|$)/.test(rel)) continue;
      copyTree(from, to);
      continue;
    }
    if (shouldSkipFile(name)) continue;
    if (relIsStickerImage(from)) continue;
    cpSync(from, to);
  }
}

function redactTree(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      redactTree(full);
      continue;
    }
    const ext = path.extname(name).toLowerCase();
    if (!TEXT_EXT.has(ext) && name !== "SHARE.md") continue;
    let text = readFileSync(full, "utf8");
    let changed = false;
    for (const [re, rep] of REDACTIONS) {
      if (re.test(text)) {
        text = text.replace(re, rep);
        changed = true;
        // reset lastIndex for global regex reuse
        re.lastIndex = 0;
      }
      re.lastIndex = 0;
    }
    if (changed) writeFileSync(full, text, "utf8");
  }
}

if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
copyTree(root, stage);
redactTree(stage);

for (const d of [
  "data/memory",
  "data/state",
  "data/keys",
  "data/agents",
  "data/stickers",
  "data/cache",
]) {
  mkdirSync(path.join(stage, d), { recursive: true });
}
for (const f of [
  "data/memory/.gitkeep",
  "data/state/.gitkeep",
  "data/keys/.gitkeep",
  "data/cache/.gitkeep",
]) {
  writeFileSync(path.join(stage, f), "");
}
const stickerReadme = path.join(root, "data/stickers/README.md");
if (existsSync(stickerReadme)) {
  cpSync(stickerReadme, path.join(stage, "data/stickers/README.md"));
}

writeFileSync(
  path.join(stage, "SHARE.md"),
  `# 分享包说明

本压缩包已去掉个人信息与本地运行痕迹：

- 不含 \`config.json\`（请复制 \`config.example.json\` 为 \`config.json\` 后填写）
- 不含 \`data/memory\`、\`data/state\`、\`data/agents\`、\`data/cache\`（含聊天缓存图）
- 不含 \`node_modules\` / \`dist\`（解压后执行 \`pnpm install\` 再 \`pnpm build\`）
- 不含本地表情图片（仅保留 \`data/stickers/README.md\`）
- 已脱敏示例 QQ / 昵称 / 本机用户名路径；眼睛主人请自行改 \`EYE_OWNER_QQ\` 与 \`social.eye.secret\`

本版已含：人设/配音热切换、小约定/悄悄话/表情导演/回看/口味地图、
QQ 空间草稿确认、本机眼睛（\`pnpm eye\`）+ 加密保险柜、本地 TTS（\`pnpm tts\`）。

快速开始见 \`docs/说明书.md\`。技能见 \`docs/记忆海-技能说明.txt\`，眼睛见 \`docs/记忆海-眼睛说明.txt\`。
`,
  "utf8",
);

mkdirSync(outDir, { recursive: true });
if (existsSync(destZip)) rmSync(destZip, { force: true });

const ps = `
$ErrorActionPreference = 'Stop'
Compress-Archive -Path '${stage.replace(/'/g, "''")}\\*' -DestinationPath '${destZip.replace(/'/g, "''")}' -CompressionLevel Optimal
`;
const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], {
  encoding: "utf8",
});
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(r.status ?? 1);
}

rmSync(stage, { recursive: true, force: true });
const size = statSync(destZip).size;
console.log(JSON.stringify({ ok: true, zip: destZip, bytes: size }, null, 2));
