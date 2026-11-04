# 分享包说明

本压缩包已去掉个人信息与本地运行痕迹：

- 不含 `config.json`（请复制 `config.example.json` 为 `config.json` 后填写）
- 不含 `data/memory`、`data/state`、`data/agents`、`data/cache`（含聊天缓存图）
- 不含 `node_modules` / `dist`（解压后执行 `pnpm install` 再 `pnpm build`）
- 不含本地表情图片（仅保留 `data/stickers/README.md`）
- 已脱敏示例 QQ / 昵称 / 本机用户名路径；眼睛主人请自行改 `EYE_OWNER_QQ` 与 `social.eye.secret`

本版已含：人设/配音热切换、小约定/悄悄话/表情导演/回看/口味地图、
QQ 空间草稿确认、本机眼睛（`pnpm eye`）+ 加密保险柜、本地 TTS（`pnpm tts`）。

快速开始见 `docs/说明书.md`。技能见 `docs/记忆海-技能说明.txt`，眼睛见 `docs/记忆海-眼睛说明.txt`。
