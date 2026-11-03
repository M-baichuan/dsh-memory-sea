# 从旧 qq-bridge 迁移说明书

面向已经跑过 **SnowLuma + qq-bridge + DSH（含 Magpie / workbuddy 反代）** 的用户。  
目标：切到本仓库 **DSH-Memory-Sea**，不丢通道配置，并避开「每次启动被切回官方 DeepSeek-V4.1-Flash」的坑。

通用安装与功能说明见 [说明书.md](./说明书.md)。本文只讲「旧 → 新」怎么走。

---

## 1. 先搞清三样东西各干什么

| 路径 / 组件 | 角色 | 迁到新项目后 |
|---|---|---|
| `D:\SnowLuma` | QQ → OneBot 协议端 | **保留，继续用** |
| 旧 `qq-bridge` | QQ ↔ DSH 桥 + 仿真/工具 | **停掉进程**；目录可留备份 |
| Magpie / workbuddy 等 | 模型反代 / 供应商 | **继续在 DSH 里配**；桥接默认不再强切模型 |
| 本仓库 `packages/bridge` | 新的 QQ ↔ DSH 桥 | **替代旧 qq-bridge** |
| 本仓库 `memory-sea` | 艾宾浩斯 + 场合隔离记忆海 | **新能力**（旧桥的 memoryCard 不自动导入） |

一句话：**SnowLuma 别删；旧桥别和本桥同时开；模型在 DSH 里选，别让桥瞎改。**

---

## 2. 迁移前检查清单

1. [ ] 确认旧 qq-bridge 的 `config.json` 还在（下面字段要对）  
2. [ ] 记下当前 **桌面端** API 地址（随机端口，重启后可能变；可用 `pnpm discover:dsh`）  
3. [ ] Magpie / 自定义供应商在桌面端仍可用  
4. [ ] 准备好停旧桥：关掉旧 bridge 窗口 / 进程，避免抢 OneBot 消息  

桌面端专用步骤见 [桌面端说明书.md](./桌面端说明书.md)。

---

## 3. 字段对照表（旧 → 新）

以旧 `qq-bridge/config.json` 为例：

| 旧配置 | 新 `config.json` | 说明 |
|---|---|---|
| `snowluma.wsUrl` | `onebot.wsUrl` | 一般 `ws://127.0.0.1:3001` |
| `snowluma.httpUrl` | `onebot.httpUrl` | 一般 `http://127.0.0.1:3000` |
| `snowluma.accessToken` | `onebot.accessToken` | 必须与 SnowLuma 一致 |
| （机器人 QQ） | `onebot.selfId` | 旧配置常没有；填**机器人自己的 QQ 号**，群 @ 识别才准 |
| `dsh.baseUrl` | `dsh.baseUrl` | **照抄旧值**；动态端口要以当前 DSH 为准 |
| `dsh.provider` / `dsh.model` | 见第 4 节 | 默认**不要**原样强制锁定 |
| `ownerQQ` | `access.admins` | 写成字符串数组，如 `"10001"` |
| `allow.private` | `access.allowUsers` | 数字改成字符串 |
| `allow.groups` | `access.allowGroups` | 同上 |
| 触发词 / 名字 | `access.triggerNames` | 可把旧 `mustReplyKeywords`、唤醒关键词合进来 |
| `workspaceTitle` | `dsh.workspaceGroup` | 可继续用「QQ 聊天」 |
| `consolePort` 3100 | `bridge.consolePort` 3120 | 新控制台默认 3120，避免和旧控制台抢端口 |

### 示例（按你旧配置映射后的形态）

```json
{
  "onebot": {
    "wsUrl": "ws://127.0.0.1:3001",
    "httpUrl": "http://127.0.0.1:3000",
    "accessToken": "（从旧 snowluma.accessToken 复制）",
    "selfId": "（填机器人 QQ，可先留空再补）"
  },
  "dsh": {
    "baseUrl": "http://127.0.0.1:43189",
    "profile": "desktop",
    "model": "",
    "provider": "",
    "lockModel": false,
    "workspaceGroup": "QQ 聊天"
  },
  "access": {
    "admins": ["10001"],
    "allowUsers": ["10001", "10002"],
    "allowGroups": ["20001"],
    "requireMention": true,
    "triggerNames": ["鲸鱼娘", "鲸鲸", "小鲸鱼", "大肥鱼", "鲸鱼", "d指导", "deepseek"]
  }
}
```

把旧 `config.json` 里的真实 QQ / token / 端口按上表填进本仓库 `config.json`（不要把含隐私的配置发给别人）。

---

## 4. 模型 / Magpie：你这种「以前被切走」该怎么做

### 旧桥为什么会切模型

旧 qq-bridge 会对会话调用 `session.selectModel`，默认偏向官方 `deepseek-flash`（V4.1-Flash），还可能写进 DSH 全局默认。所以你每次开 Magpie / 自定义供应商，一启动桥又被拧回去。

### 新项目默认策略

- `lockModel: false`
- `model` / `provider` 留空  
→ **桥接不改模型**，沿用你在 DSH Web 里选好的 Magpie / workbuddy 模型。

### 推荐操作顺序（有旧配置的人按这个做）

```text
1. 完全退出旧 qq-bridge
2. 确认 Magpie 在跑（若反代要单独开）
3. 打开 DeepSeek Harness 桌面端（不是浏览器 Web）
4. 在桌面端确认模型仍是 Magpie / 自定义供应商（未被切回官方 flash）
5. pnpm discover:dsh → 更新 config.json 的 dsh.baseUrl
6. 再启动本仓库：pnpm bridge
```

### 什么时候才开 `lockModel`

仅当你**确定**要让每个新建 QQ 会话都钉死某一个模型时：

```json
"dsh": {
  "lockModel": true,
  "provider": "workbuddy",
  "model": "deepseek-v4.1-flash"
}
```

`provider` / `model` 必须是 **DSH 里实际出现的 id**，不要凭猜测填官方名。  
用 Magpie 时，填 Magpie 在 DSH 里登记的供应商名和模型名。

**不建议**一上来就 lock：先 `lockModel: false` 跑通，确认模型稳定后再考虑锁定。

---

## 5. 推荐启动顺序

```text
① SnowLuma（D:\SnowLuma）—— QQ 已登录、OneBot WS 可连
② Magpie（若反代单独进程）
③ DeepSeek Harness 桌面端 —— 确认 Magpie 模型
④ pnpm discover:dsh，必要时改 config.json（别误用 Magpie 的 3425 端口）
⑤ （首次）完全退出桌面端 → pnpm setup:plugins → 再打开桌面端
⑥ pnpm bridge
⑦ （可选）pnpm console → http://127.0.0.1:3120
```

Windows 可用：

```powershell
cd D:\memory_sea_project
pnpm build
pnpm bridge
```

或：

```powershell
.\deploy\windows\start-all.ps1
```

（脚本不会帮你停旧桥，请先手动停。）

---

## 6. 旧功能哪些会带来、哪些不会

| 旧 qq-bridge 能力 | 迁到本仓库？ |
|---|---|
| 私聊/群收发、白名单、@/触发名 | 有（`access` + bridge） |
| 独立会话映射 | 有（`data/state/sessions.json`，**不会自动拷旧映射**） |
| 长期记忆（艾宾浩斯 + 场合隔离 + pin） | 有（记忆海，新库） |
| 二代仿真 socialV2 / 表情 / 语音 / 点歌 | **V1 没有**，仍靠旧桥或以后再做 |
| 黑话学习 slang | **没有** |
| 旧 memoryCard 卡片 | **不自动导入**；需要的话以后可做导入工具 |

因此：若你还强依赖仿真二代全套工具，可以暂时继续用旧桥；若主诉求是「稳定聊天 + 记忆海 + 不被切模型」，用本仓库即可。

---

## 7. 数据与备份

| 东西 | 建议 |
|---|---|
| 旧 `qq-bridge/config.json` | 留着当备份，不要删 |
| 旧 `qq-bridge/state/` | 会话映射不自动迁移；需要可对照，不必强迁 |
| `D:\SnowLuma` | 原样保留 |
| 新 `data/memory/sea.sqlite` | 新记忆库；定期复制备份 |
| 新 `config.json` | 勿提交 git（已在 `.gitignore`） |

---

## 8. 验收（迁完勾一遍）

1. [ ] 旧 qq-bridge 进程已退出  
2. [ ] SnowLuma 在线，`ws://127.0.0.1:3001` 正常  
3. [ ] 桌面端能开，`config.json` 的 `dsh.baseUrl` 与 `pnpm discover:dsh` 一致  
4. [ ] 桌面端模型仍是 Magpie / 自定义供应商，**没有**被切回官方 flash  
5. [ ] `pnpm bridge` 日志出现 OneBot connected  
6. [ ] 管理员号私聊能收到回复  
7. [ ] 群里 @ 或喊触发名有回复；陌生人/未批准群被拒绝  
8. [ ] 说一句「我叫某某」，下一轮相关提问能感到记忆注入（或控制台能召回）  

---

## 9. 常见问题

**Q：桌面端端口老变怎么办？**  
A：跑 `pnpm discover:dsh` 更新 `dsh.baseUrl`；或在桌面端把 `dsh-desktop.port` 固定成常数（见桌面端说明书）。

**Q：selfId 不填行不行？**  
A：私聊一般能用；群 @ 识别可能不准。建议补上机器人 QQ。

**Q：旧会话上下文还在吗？**  
A：DSH 里旧 session 还在，但本桥用自己的 `sessions.json` 映射，等于新开 QQ↔Agent 对应关系。长期事实靠记忆海重新积累（或以后做导入）。

**Q：想和旧桥来回切？**  
A：可以，但同一时刻只能开一个桥。切回旧桥前停本仓库 bridge；切回来前停旧桥，并再检查 DSH 模型有没有被旧桥改掉。

**Q：记忆海和旧 memoryCard 能合并吗？**  
A：当前版本不自动合并。新记忆从零开始；旧卡片文件若还在，可先人工备份，后续有需要再做导入脚本。

---

## 10. 相关文档

- 总说明书：[说明书.md](./说明书.md)  
- 记忆模型：[memory-model.md](./memory-model.md)  
- 架构：[architecture.md](./architecture.md)  
- 安全边界：[RULES.md](../RULES.md)  
