# 分享包说明

本压缩包已去掉个人信息与本地运行痕迹：

- 不含 `config.json`（请复制 `config.example.json` 为 `config.json` 后填写）
- 不含 `data/memory`、`data/state`、`data/agents` 中的会话/记忆数据
- 不含 `node_modules` / `dist`（解压后执行 `pnpm install` 再 `pnpm build`）
- 不含本地表情图片（仅保留 `data/stickers/README.md`）

本版已含：人设预设热切换、`scripts/access.ps1` 加群/私聊、本地 TTS（`pnpm tts`，`replyMode: ask`）。

快速开始见 `docs/说明书.md` 与 `docs/桌面端说明书.md`。
语音：另开 `pnpm tts`，用户说「用语音回复」才发语音。
