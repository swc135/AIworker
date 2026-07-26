# OpenCode 开发者指南

## 1. 项目概述

OpenCode 是一个基于 AI 大模型的智能开发助手运行时。它采用"规则驱动 + 技能编排 + MCP 工具链"架构，通过 CLI 二进制运行在沙箱化 Linux 容器中。

**核心设计原则**：
- 所有能力通过 Markdown 规则和技能文件声明式定义，无需修改二进制
- 技能间通过文件系统（`.monkeycode/specs/`）传递产物，松耦合协作
- MCP 协议作为与外部服务交互的统一接口
- 每个会话拥有完整独立的文件系统工作区

## 2. 项目结构

```
project-root/
├── src/
│   ├── cli/                  # CLI 入口和命令解析
│   │   ├── main.ts           # 主入口
│   │   ├── config.ts         # 配置加载（opencode.json）
│   │   └── session.ts        # 会话管理
│   ├── core/
│   │   ├── agent.ts          # Agent 核心循环（推理-行动循环）
│   │   ├── task_orchestrator.ts # 任务编排器
│   │   └── context.ts        # 上下文管理器
│   ├── rules/
│   │   ├── engine.ts         # 规则引擎核心
│   │   ├── loader.ts         # 规则文件加载器
│   │   └── parser.ts         # Markdown 规则解析器
│   ├── skills/
│   │   ├── registry.ts       # 技能注册表
│   │   ├── loader.ts         # SKILL.md 加载器
│   │   ├── executor.ts       # 技能执行器
│   │   └── lifecycle.ts      # 技能生命周期管理
│   ├── mcp/
│   │   ├── client.ts         # MCP 客户端
│   │   ├── tools.ts          # 工具注册和调度
│   │   ├── types.ts          # MCP 类型定义
│   │   └── dispatcher.ts     # 工具调用分发器
│   ├── llm/
│   │   ├── provider.ts       # 模型提供商抽象
│   │   ├── adapter.ts        # SDK 适配层
│   │   ├── stream.ts         # 流式响应处理
│   │   └── rate_limit.ts     # 速率限制
│   ├── terminal/
│   │   ├── manager.ts        # 后台终端管理器
│   │   ├── process.ts        # 进程生命周期
│   │   └── log.ts            # 日志读取
│   ├── git/
│   │   ├── credential.ts     # 凭据管理
│   │   ├── submodule.ts      # Submodule 操作
│   │   └── workflow.ts       # Git 工作流
│   ├── security/
│   │   ├── guard.ts          # 安全护栏执行
│   │   ├── sanitizer.ts      # 输入清洗
│   │   └── audit.ts          # 操作审计
│   └── utils/
│       ├── fs.ts             # 文件系统工具
│       ├── markdown.ts       # Markdown 工具
│       └── logger.ts         # 日志工具
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── .monkeycode/
│   ├── docs/                 # 项目文档
│   ├── specs/                # 功能规格
│   └── MEMORY.md             # 用户记忆
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## 3. 环境搭建

### 3.1 前置要求

| 依赖 | 最低版本 | 用途 |
|------|---------|------|
| Node.js | >= 20.0.0 | 运行时 |
| npm / pnpm | >= 9.0.0 | 包管理 |
| Git | >= 2.40 | 版本控制 |
| Docker / Podman | >= 24.0 | 容器构建（publish-website） |

### 3.2 初始化

```bash
# 克隆仓库
git clone https://github.com/swc135/AIworker
cd AIworker

# 安装依赖
npm install

# 初始化 submodule（如有）
git submodule update --init --recursive --depth 1
```

### 3.3 配置文件

创建 `opencode.json`：

```json
{
  "snapshot": false,
  "agent": { "title": { "disable": true } },
  "model": "your-provider/your-model",
  "provider": {
    "your-provider": {
      "npm": "@ai-sdk/openai",
      "name": "your-provider",
      "options": {
        "baseURL": "https://api.your-llm.com/v1",
        "apiKey": "${YOUR_API_KEY}"
      },
      "models": {
        "your-model": {
          "limit": { "context": 200000, "output": 32000 }
        }
      }
    }
  },
  "instructions": [
    ".ai-ready/rules/*.md"
  ],
  "skills": {
    "paths": [".ai-ready/skills/"]
  }
}
```

## 4. 开发命令

```bash
# 开发模式（热重载）
npm run dev

# 构建
npm run build

# 运行测试
npm test

# 运行单个测试文件
npm test -- --run path/to/test.test.ts

# 类型检查
npm run typecheck

# 代码检查
npm run lint
```

### 4.1 自定义构建脚本

```json
{
  "scripts": {
    "dev": "tsx watch src/cli/main.ts",
    "build": "tsc && node scripts/build.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/ tests/"
  }
}
```

## 5. 核心模块扩展指南

### 5.1 添加新规则

在 `.ai-ready/rules/` 下创建 `{rule-name}.md`：

```markdown
# 规则标题

## 触发条件
[描述什么情况下应用此规则]

## 规则内容
[具体的约束或指令]

## 示例
### 正确
[正确做法]

### 错误
[错误做法]
```

规则会被 `instructions` glob 自动加载，无需修改代码。

### 5.2 添加新技能

在 `.ai-ready/skills/{skill-name}/` 下创建 `SKILL.md`：

```markdown
---
name: my-skill
description: 技能描述
arguments:
  - name: input_param
    description: 参数说明
    required: false
---

# 技能名称

## 工作流
1. 步骤一
2. 步骤二
```

创建 `.agent-resource-version` 文件记录版本。

### 5.3 添加新 MCP 工具

在 `src/mcp/tools.ts` 中注册：

```typescript
import { registerTool } from './dispatcher';

registerTool({
  namespace: 'mcaiBuiltin',
  name: 'my_tool',
  description: '工具描述',
  parameters: {
    param1: { type: 'string', required: true },
  },
  handler: async (params) => {
    // 实现工具逻辑
    return { result: 'success' };
  },
});
```

### 5.4 添加新模型提供商

在 `src/llm/provider.ts` 中实现 `LLMProvider` 接口：

```typescript
interface LLMProvider {
  name: string;
  chat(messages: Message[], options: ChatOptions): Promise<ChatResponse>;
  chatStream(messages: Message[], options: ChatOptions): AsyncIterable<ChatChunk>;
  listModels(): Promise<ModelInfo[]>;
}
```

## 6. 测试规范

### 6.1 测试结构

```
tests/
├── unit/                    # 单元测试（与 src 结构对应）
│   ├── rules/
│   │   ├── engine.test.ts
│   │   └── parser.test.ts
│   ├── skills/
│   │   ├── registry.test.ts
│   │   └── executor.test.ts
│   └── mcp/
│       ├── client.test.ts
│       └── dispatcher.test.ts
├── integration/             # 集成测试
│   ├── agent-loop.test.ts   # Agent 推理-行动循环
│   ├── skill-pipeline.test.ts # 技能流水线
│   └── mcp-e2e.test.ts      # MCP 端到端
└── fixtures/                # 测试夹具
    ├── rules/               # 示例规则文件
    ├── skills/              # 示例技能文件
    └── tasks/               # 示例任务配置
```

### 6.2 测试原则

1. 每个模块必须有对应的单元测试
2. 技能执行必须验证输入输出契约
3. MCP 工具调用必须 mock 外部服务
4. 安全规则必须有边界情况测试

## 7. 调试与排错

### 7.1 查看 Agent 运行日志

```bash
# 查看会话日志
cat /tmp/opencode/session_{session_id}.log

# 查看终端进程日志
cat /tmp/opencode/terminal_{terminal_id}.log
```

### 7.2 常见问题

| 问题 | 排查方向 |
|------|---------|
| 技能未加载 | 检查 `skills.paths` 配置和 `SKILL.md` YAML frontmatter |
| 规则未生效 | 检查 `instructions` glob 是否匹配规则文件 |
| MCP 工具调用失败 | 检查工具名是否正确注册，查看 dispatcher 日志 |
| 模型调用超时 | 检查网络连通性，查看 rate_limit 状态 |
| 终端进程异常 | 通过 `background_terminal_output_path` 获取日志 |

## 8. 发布与部署

### 8.1 构建产物

```bash
npm run build
# 产出：dist/opencode (可执行二进制)
```

### 8.2 Docker 部署

```dockerfile
FROM node:20-alpine
COPY dist/ /app/
COPY .ai-ready/ /app/.ai-ready/
COPY opencode.json /app/
WORKDIR /app
ENTRYPOINT ["node", "main.js"]
```

### 8.3 平台部署流程

1. 构建二进制产物
2. 将产物和规则/技能文件打包为镜像
3. 推送到 `registry.monkeycode-ai.online`
4. 平台调度器按需创建容器实例
5. 容器内执行 OpenCode CLI 处理会话

## 9. 贡献规范

### 9.1 分支命名

```
YYMMDD-(feat|fix|chore|refactor)-short-description
```

示例：`260726-feat-add-image-analysis-tool`

### 9.2 提交信息

```
<type>(<scope>): <description>

feat(mcp): add image analysis tool
fix(skills): resolve deploy-website port conflict
chore(deps): update opencode-ai/plugin to 1.17.0
```

### 9.3 代码审查清单

- [ ] 是否遵循已有的代码风格
- [ ] 是否添加了必要的单元测试
- [ ] 是否更新了相关文档
- [ ] 是否处理了边界情况
- [ ] 是否引入了安全漏洞
- [ ] 是否正确处理了错误
