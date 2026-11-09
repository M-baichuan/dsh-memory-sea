# DSH-Memory-Sea

DeepSeek Harness + OneBot（SnowLuma）QQ 鲸鱼娘机器人，带艾宾浩斯遗忘曲线长期记忆库「记忆海」。

## 需要什么

- Node.js ≥ 22
- 本机 **DeepSeek Harness 桌面端**（profile=`desktop`；不是浏览器 Web）
- SnowLuma / NapCat（OneBot v11，默认 `ws://127.0.0.1:3001`）

## 快速开始

```bash
pnpm install
pnpm build
copy config.example.json config.json   # Windows
# 编辑 config.json：selfId、admins、allowUsers/Groups、accessToken、dsh.baseUrl

pnpm discover:dsh                      # 探测桌面端当前端口，填进 dsh.baseUrl
pnpm setup:plugins                     # 默认装到 desktop profile
pnpm bridge                            # 启动 QQ ↔ DSH 桥接
pnpm console                           # 可选：本机控制台 :3120
pnpm maintenance                       # 夜间巩固 / 衰减剪枝
```

## 包结构

| 路径 | 作用 |
|---|---|
| `packages/memory-sea` | 艾宾浩斯记忆库 |
| `packages/bridge` | OneBot ↔ DSH 桥接进程 |
| `packages/persona` | 鲸鱼娘人设 Markdown |
| `packages/shared` | 配置 schema 与 scope |
| `plugins/*` | DSH cordis bundles |

**完整说明书：** [docs/说明书.md](docs/说明书.md)  
**桌面端（你现在这种）：** [docs/桌面端说明书.md](docs/桌面端说明书.md)  
**从旧 qq-bridge 迁过来：** [docs/从旧qq-bridge迁移说明书.md](docs/从旧qq-bridge迁移说明书.md)

其它文档：[架构](docs/architecture.md) · [记忆模型](docs/memory-model.md) · [目录地图](docs/FOLDER_MAP.md)

## 安全

见 [RULES.md](RULES.md)。请用小号，遵守 QQ 用户协议。
