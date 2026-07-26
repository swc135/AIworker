# OpenCode / MonkeyCode-AI 智能开发平台文档索引

## 项目概述

OpenCode 是 MonkeyCode-AI 智能开发平台的核心 AI 编程助手系统，运行在沙箱化 Linux 容器中，提供代码开发、部署预览、功能设计、项目管理等全生命周期 AI 辅助能力。

## 文档结构

### 核心文档

| 文档 | 内容 | 状态 |
|------|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 系统架构全景（所有端分析、组件说明、数据流、安全架构） | ✅ |
| [INTERFACES.md](./INTERFACES.md) | 数据模型、MCP 工具 API 契约、配置文件格式、错误码 | ✅ |
| [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) | 项目搭建、构建命令、模块扩展、测试规范、调试排错 | ✅ |

### 模块设计文档

| 文档 | 内容 |
|------|------|
| [模块/规则引擎.md](./模块/规则引擎.md) | 规则加载、解析、注入的设计与实现 |
| [模块/技能编排系统.md](./模块/技能编排系统.md) | 技能注册、匹配、执行、生命周期 |
| [模块/MCP工具链.md](./模块/MCP工具链.md) | 工具分发器、内置/远程适配器、速率限制 |
| [模块/任务编排.md](./模块/任务编排.md) | 会话管理、上下文构建、Agent 推理循环 |
| [模块/模型代理层.md](./模块/模型代理层.md) | 提供商抽象、流式处理、速率限制 |

### 专有概念

| 文档 | 内容 |
|------|------|
| [专有概念/EARS规范.md](./专有概念/EARS规范.md) | EARS 五种需求模式和 INCOSE 质量规则 |
| [专有概念/MCP协议.md](./专有概念/MCP协议.md) | MCP 协议层次、工具命名、调用流程 |
| [专有概念/技能生命周期.md](./专有概念/技能生命周期.md) | 技能从加载到执行的完整状态转换 |
| [专有概念/规则优先级.md](./专有概念/规则优先级.md) | 28 条规则的优先层级和冲突解决 |

## 快速导航

| 想了解... | 去哪里看 |
|-----------|---------|
| 平台整体是什么样的 | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| 所有端如何设计 | [ARCHITECTURE.md §1-7](./ARCHITECTURE.md#端架构分析) |
| 有什么 API 和工具可用 | [INTERFACES.md](./INTERFACES.md) |
| 怎么搭建开发环境 | [DEVELOPER_GUIDE.md §3](./DEVELOPER_GUIDE.md#3-环境搭建) |
| 每个模块怎么实现 | [模块/](./模块/) 目录 |
| 怎么扩展新功能 | [DEVELOPER_GUIDE.md §5](./DEVELOPER_GUIDE.md#5-核心模块扩展指南) |
| 关键概念的定义 | [专有概念/](./专有概念/) 目录 |

## 关键服务端点

| 服务 | 地址 |
|------|------|
| LLM 模型代理 | `https://proxy.monkeycode-ai.com/v1` |
| Showcase 提交 | `https://ugc-submit.showcase.monkeycode-ai.online/v1/create` |
| Showcase 状态查询 | `https://ugc-submit.showcase.monkeycode-ai.online/v1/status` |
| Showcase 撤回 | `https://ugc-submit.showcase.monkeycode-ai.online/v1/recall` |
| Docker 镜像代理 | `registry.monkeycode-ai.online` |
| MonkeyScan 安全扫描 | `https://scan.monkeycode-ai.com` |
