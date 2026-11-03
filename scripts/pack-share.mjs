#!/usr/bin/env node
/**
 * Build a sanitized share zip into D:\qq_sea (no personal config/state).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.DSH_SHARE_OUT || "D:\\qq_sea";
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

function shouldSkipFile(name) {
  if (name === "config.json") return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (name.endsWith(".log") || name.endsWith(".tsbuildinfo")) return true;
  return false;
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
      if (/^data\/(memory|state|keys|agents)(\/|$)/.test(rel)) continue;
      copyTree(from, to);
      continue;
    }
    if (shouldSkipFile(name)) continue;
    // Skip sticker image binaries; README kept via later copy.
    if (relIsStickerImage(from)) continue;
    cpSync(from, to);
  }
}

function relIsStickerImage(abs) {
  const rel = path.relative(root, abs).replace(/\\/g, "/");
  if (!rel.startsWith("data/stickers/")) return false;
  return /\.(png|jpe?g|gif|webp)$/i.test(rel);
}

if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
copyTree(root, stage);

for (const d of ["data/memory", "data/state", "data/keys", "data/agents", "data/stickers"]) {
  mkdirSync(path.join(stage, d), { recursive: true });
}
for (const f of ["data/memory/.gitkeep", "data/state/.gitkeep", "data/keys/.gitkeep"]) {
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
- 不含 \`data/memory\`、\`data/state\`、\`data/agents\` 中的会话/记忆数据
- 不含 \`node_modules\` / \`dist\`（解压后执行 \`pnpm install\` 再 \`pnpm build\`）
- 不含本地表情图片（仅保留 \`data/stickers/README.md\`）

本版已含：人设预设热切换、\`scripts/access.ps1\` 加群/私聊、本地 TTS（\`pnpm tts\`，\`replyMode: ask\`）。

快速开始见 \`docs/说明书.md\` 与 \`docs/桌面端说明书.md\`。
语音：另开 \`pnpm tts\`，用户说「用语音回复」才发语音。
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
