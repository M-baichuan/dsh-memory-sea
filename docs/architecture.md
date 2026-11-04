# 架构说明

## 拓扑

```
QQ → SnowLuma(OneBot) → packages/bridge → DeepSeek Harness
                              ↕
                       packages/memory-sea
                              ↕
                       packages/persona + plugins/*
```

## 深层模块

1. **memory-sea**：`recall` / `remember` / `reinforce` / `pin` / `runMaintenance`  
   （已并入记忆星海思路：visibility 场合隔离、pin、融合打分、星海图；不外挂第二服务）
2. **bridge**：`start` / `stop`；会话映射、准入、记忆注入、分句发送
3. **persona**：人设内容；与记忆库解耦
4. **DSH bundles**：工具面与 preset 挂载

## 记忆作用域

- `user:` 跨群复用的用户事实
- `group:` 群约定与事件
- `relation:user@group` 该用户在该群内的关系侧写
