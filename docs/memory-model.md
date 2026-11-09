# 记忆海模型

本仓库已按「记忆星海」思路并入：场合隔离（visibility）、钉住（pin）、融合打分召回。不外挂第二套记忆服务。

## 公开接口

- `recall(scope, query, limit|options) → Evidence[]`
- `remember(scope, draft) → MemoryId`
- `reinforce(ids)`
- `pin(id, pinned?)` / `setVisibility(id, visibility)`
- `runMaintenance()`（跳过 pin）
- `listGraph(limit)`（控制台星海图）

## 场合隔离（visibility）

| 值 | 行为 |
|---|---|
| `private` | 仅私聊场合可召回；群聊绝不注入 |
| `group` | 仅同 `groupId` 的群聊可召回 |
| `public` | 私聊/群聊都可 |

桥接默认：私聊抽取 → `private`；群聊抽取 → `group`。

## 钉住（pin）

性格底色 / 账号约定等可 `pin=true`。钉住记忆：

- 召回 strength 视为 1
- 夜巡不剪枝、不参与巩固归档

## 衰减与融合打分

```text
λ_eff   = base_λ × (1 − importance × 0.8)
strength = clamp(importance × e^(−λ_eff × active_days) × (1 + recall_count × 0.2), 0, 1)

freshness = e^(−ln2 × days_since_update / 14)
score = 0.45·relevance + 0.25·strength + 0.15·importance + 0.15·freshness
        (+0.08 if pin)

prune when (not pin) and strength < pruneThreshold (default 0.05)
```

召回成功会提升 `recall_count`；未钉住条目会重置 `active_days_anchor`（测试效应）。

## 分类默认 λ

| category | baseLambda | 说明 |
|---|---|---|
| identity | 0.012 | 身份 |
| fact | 0.018 | 稳定偏好/事实 |
| event | 0.035 | 事件与约定 |
| assumption | 0.045 | 低置信推测 |
| chat_noise | 0.08 | 闲聊噪声 |

## Scope

- `user:<id>` 跨群用户记忆
- `group:<id>` 群级记忆
- `relation:<user>@<group>` 群内关系侧写

群聊召回同时查三级；私聊只查 `user`。
