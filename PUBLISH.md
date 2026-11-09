# 发布版说明（脱敏构建）

本目录是 DSH-Memory-Sea 源码的可公开发布副本，由构建脚本自动生成。

## 已移除

- `config.json` 及全部 `config.json.bak*` 备份
- `data/` 下的运行时数据：记忆库 sqlite、会话状态、密钥、聊天缓存图片、本地知识库、收藏表情图片
  （仅保留 `data/stickers/README.md` 与空目录骨架 `.gitkeep`）
- `plugins/console/data/` 下 console 自带的 sqlite 状态
- `node_modules/`、各包 `dist/`、`.git/`、日志、锁文件、`*.tsbuildinfo`

## 已替换

| 原值 | 替换后 |
| --- | --- |
| 真实主人 / 好友 QQ 号、群号、机器人 QQ 号 | `10001` / `10002` / `20001` / `10000` |
| OneBot accessToken、consoleToken、眼睛 secret | `YOUR_ONEBOT_TOKEN` / `whalesea-console-token` / `YOUR_EYE_SECRET` |
| 真实群友昵称、本机用户名 | `ExampleNick` / `YourUser` |
| 与作者本人昵称对应的称呼 | 中性示例词 |
| 本机项目绝对路径 | 中性占位路径 |

保留 `鲸鱼娘` / `鲸鲸` / `小鱼` / `蓝色肥鱼` 等项目角色名与唤醒词：
它们是本开源项目的产品设计内容，不是个人身份标识；改动会破坏 README、人设与测试的一致性。
与作者本人昵称直接对应的那个称呼已替换为中性示例词。

## 快速开始

```bash
pnpm install
pnpm -r run build
cp config.example.json config.json   # 然后按下面清单填写
pnpm bridge
```

## 需要使用者自行填写

- `onebot.selfId` / `onebot.accessToken`：机器人 QQ 号与 OneBot 令牌
- `access.admins` / `allowUsers` / `allowGroups`：权限白名单
- `dsh.baseUrl`：本机 DSH Web 端口（每次启动可能变化，可用 `pnpm discover:port` 回填）
- `bridge.consoleToken`：控制台口令
- `social.eye.secret`：眼睛口令
- `packages/bridge/src/social/eye.ts` 的 `EYE_OWNER_QQ` 兜底常量改为自己的主人号
- `persona.ownerTitle`：她怎么称呼你（首次设置向导可自动写入）

## 发布前建议再核一遍

```bash
# 1) 应无输出：残留的真实配置 / 运行时文件
find . -name "config.json" -o -name "*.sqlite" -o -name "*.bak*" -o -name "*.log"
# 2) 应命中占位符，确认脱敏已生效
grep -rIl "YOUR_ONEBOT_TOKEN" packages scripts docs
# 3) 按上表逐项核对占位符仍在，缺失说明脱敏未跑全
```

首次设置向导：`pnpm console` 后打开 `http://127.0.0.1:3120/setup.html`。
