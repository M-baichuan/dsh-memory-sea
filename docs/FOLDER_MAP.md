# 目录地图

```text
DSH-Memory-Sea/
├── packages/shared        # 配置 schema、scope
├── packages/memory-sea    # 艾宾浩斯记忆库
├── packages/bridge        # OneBot ↔ DSH 桥接进程
├── packages/persona       # 鲸鱼娘人设 Markdown
├── plugins/memory-tools   # DSH bundle：记忆工具
├── plugins/whale-preset   # DSH bundle：人设 preset
├── plugins/console        # 本机控制台
├── data/                  # 运行时数据（gitignore）
├── deploy/                # SnowLuma / Windows 示例
├── scripts/               # 安装、冒烟、衰减测试入口
├── docs/                  # 架构与模型文档
└── tests/                 # 跨包测试
```

运行时配置：根目录 `config.json`（由 `config.example.json` 复制）。
