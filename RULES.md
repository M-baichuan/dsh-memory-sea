# QQ 权限与安全边界

本仓库把个人 QQ 号接到 DeepSeek Harness。协议端（SnowLuma / NapCat）属于非官方实现，账号风控与掉线是常态。请自行遵守 QQ 用户协议与当地法律。

## 硬边界

1. **默认拒绝陌生人**：未在 `access.allowUsers` / `access.allowGroups` 中的私聊与群聊不进 agent，只回一句待批准提示（管理员除外）。
2. **群聊默认需触发**：`requireMention=true` 时，非 @ / 非触发名消息不进模型队列。
3. **高危动作不经模型**：改群名片、踢人、发红包、任意文件上传等不在 V1 工具面；发送目标受白名单约束。
4. **记忆禁区**：人设 `BOUNDARIES.md` 列出的隐私类别不得写入记忆海；低置信内容进 pending，不进自动注入。
5. **本机优先**：控制台默认只绑 `127.0.0.1`，需 `consoleToken`；DSH API 假定本机回环。
6. **密钥分离**：`data/keys/` 可与数据目录分开放；不要把 `config.json`、密钥、sqlite 提交入库。

## 建议

- 使用小号运营机器人。
- 管理员 QQ 写进 `access.admins`。
- 定期跑 `pnpm maintenance` 或计划任务执行夜间巩固/剪枝。
