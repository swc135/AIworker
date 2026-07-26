# OpenCode 接口与数据模型文档

## 1. 核心数据模型

### 1.1 任务 (Task)

```typescript
interface Task {
  task_id: string;           // UUID v4，任务唯一标识
  session_id: string;        // 会话唯一标识
  workspace: string;         // 工作区绝对路径，如 "/workspace"
  autoApprove: boolean;      // 是否自动批准工具调用
  configFiles: ConfigFile[]; // 内联的规则文件内容
  env: Record<string, string>; // 环境变量
}

interface ConfigFile {
  path: string;              // 文件路径，如 "rules/guardrail.md"
  content: string;           // 文件完整内容（Markdown）
}
```

**持久化位置**：`/root/.codingmatrix/tasks/{task_id}.json`

### 1.2 会话 (Session)

```typescript
interface Session {
  session_id: string;        // 会话 UUID
  task_id: string;           // 关联的任务 ID
  status: SessionStatus;     // 会话状态
  memory_file: string | null; // MEMORY.md 路径
  created_at: number;         // Unix 时间戳（毫秒）
}

type SessionStatus = "active" | "idle" | "terminated";
```

### 1.3 规则 (Rule)

```typescript
interface Rule {
  filename: string;          // 文件名，如 "guardrail.md"
  category: RuleCategory;    // 规则类别
  content: string;           // Markdown 格式的规则内容
  priority: number;          // 加载优先级 (0-100)
}

type RuleCategory =
  | "security"       // 安全护栏
  | "behavior"       // 行为规范
  | "code_quality"   // 代码质量
  | "workflow"       // 工作流
  | "infrastructure" // 基础设施
  | "git_management"  // Git 管理
  | "project_management"; // 项目管理
```

**加载路径**：`/root/.codingmatrix/project-tpl/.ai-ready/rules/*.md`

### 1.4 技能 (Skill)

```typescript
interface Skill {
  name: string;              // 技能名称，如 "deploy-website"
  description: string;       // 技能描述
  version: string;           // 版本号
  arguments: SkillArgument[];// 输入参数定义
  instructions: string;      // SKILL.md 内容（工作流指令）
  resource_path: string;     // 技能资源目录路径
}

interface SkillArgument {
  name: string;              // 参数名
  description: string;       // 参数说明
  required: boolean;         // 是否必填
}
```

**加载路径**：`/root/.codingmatrix/project-tpl/.ai-ready/skills/{skill_name}/SKILL.md`

### 1.5 后台终端 (BackgroundTerminal)

```typescript
interface BackgroundTerminal {
  terminal_id: string;       // 终端唯一标识
  command: string;           // 执行的命令
  status: TerminalStatus;    // 运行状态
  exit_code: number | null;  // 退出码
  created_at: number;        // 创建时间戳
  output_log_path: string;   // 输出日志文件路径
}

type TerminalStatus = "running" | "completed" | "failed" | "killed";
```

### 1.6 MCP 工具调用 (ToolCall)

```typescript
interface ToolCall {
  tool_name: string;         // 工具完整名称，如 "monkeycode-ai_MonkeyCode__websearch_search"
  parameters: Record<string, unknown>; // 工具参数
  call_id: string;           // 调用唯一 ID
}

interface ToolResult {
  call_id: string;           // 关联的调用 ID
  success: boolean;          // 执行是否成功
  data: unknown;             // 返回数据
  error?: string;            // 错误信息
}
```

### 1.7 模型配置 (ModelConfig)

```typescript
interface ModelConfig {
  provider: string;          // 提供商名称，如 "monkeycode-ai"
  npm: string;               // SDK 包名，如 "@ai-sdk/anthropic"
  baseURL: string;           // 代理地址
  models: Record<string, ModelInfo>;
  disabled_providers: string[];
}

interface ModelInfo {
  limit: {
    context: number;         // 上下文窗口大小（tokens）
    output: number;          // 输出最大长度（tokens）
  };
}
```

**配置位置**：`/root/.config/opencode/opencode.json`

---

## 2. MCP 工具接口规范

### 2.1 后台终端管理

#### background_terminal_create
```
描述：在后台终端中异步执行命令
参数：
  command: string (必填)  — 要执行的 shell 命令
  timeout?: number        — 超时时间（毫秒），默认 0 表示不超时
返回：
  terminal_id: string     — 终端唯一标识符
使用规则：
  - 长时间运行的命令（如 Web 服务器）必须使用此工具
  - 禁止使用 `&` 或 `timeout` 包装替代
  - 严禁使用 `pkill`/`killall` 按进程名终止
```

#### background_terminal_list
```
描述：列出所有已创建的后台终端及其状态
参数：无
返回：
  terminals: BackgroundTerminal[]  — 终端列表
```

#### background_terminal_output_path
```
描述：获取后台终端的标准输出/标准错误日志文件路径
参数：
  terminal_id: string (必填)  — 终端 ID
返回：
  output_path: string         — 日志文件绝对路径
```

#### background_terminal_kill
```
描述：终止指定的后台终端进程
参数：
  terminal_id: string (必填)  — 终端 ID
返回：
  killed: boolean             — 是否成功终止
```

### 2.2 Web 预览

#### request_preview
```
描述：请求本地端口通过平台反向代理暴露为公网预览 URL
参数：
  port: number (1-65535, 必填)         — 本地监听端口
  additional_ip_whitelist?: string     — 额外 IP 白名单（逗号分隔）
返回：
  access_url: string                   — 公网预览地址
  preview_id: string                   — 预览会话 ID
域名后缀：*.monkeycode-ai.online
```

### 2.3 文档解析 (DocParse)

#### docparse_get_doc_upload_url
```
描述：获取文档上传预签名 URL（10 分钟有效）
参数：
  file_name: string (必填)  — 文件名（含扩展名），如 "report.pdf"
返回：
  upload_url: string        — HTTP PUT 上传地址
  url: string               — 上传后的访问 URL（传给 docparse_parse）
```

#### docparse_parse
```
描述：触发文档转 Markdown/OCR 解析
参数：
  url: string (必填)       — 文档的 HTTP(S) 地址
限制：单个文档最多 200 页
返回：
  document_id: number      — 文档 ID（用于查询结果）
  filename: string         — 文件名
  status: string           — "processing"
```

#### docparse_get_parse_result
```
描述：查询文档解析进度和结果
参数：
  document_id: number (必填)  — 文档 ID
返回：
  status: "processing" | "completed" | "failed"
  result_url?: string         — 解析结果下载链接（完成时）
```

### 2.4 图片分析/生成

#### image_analysis_create_task
```
描述：创建异步图片理解任务
参数：
  url: string (必填)             — 图片 HTTP(S) 地址（必须是真实域名）
  prompt?: string                — 自定义分析指令
  model?: string                 — 可选模型名
返回：
  task_id: string                — 任务 ID
```

#### image_analysis_get_result
```
描述：查询图片分析任务结果
参数：
  task_id: string (必填)         — 任务 ID
返回：
  done: boolean                  — 是否完成
  status: "pending" | "running" | "succeeded" | "failed"
  text?: string                  — 分析结果文本
  error_message?: string         — 错误信息
```

#### image_generate_text_to_image
```
描述：文生图异步任务
参数：
  prompt: string (必填)          — 生成提示词
  ratio?: "auto" | "1:1" | "4:3" | "3:4" | "16:9" | "9:16"
返回：
  task_id: string                — 任务 ID
```

#### image_generate_query_task
```
描述：查询图片生成任务结果
参数：
  task_id: string (必填)         — 任务 ID
返回：
  status: "processing" | "running" | "completed" | "failed"
  image_urls: string[]           — 生成图片的 URL 列表（仅 completed 时）
```

#### imgsearch_search
```
描述：根据文本查询执行图片搜索
参数：
  query: string (必填)           — 搜索查询文本
  count?: number                 — 最大结果数（默认 5，最大 5）
  image?: {
    aspects?: ("wide" | "tall" | "square")[]
    width_min?: number
    width_max?: number
    height_min?: number
    height_max?: number
  }
返回：
  results: ImageResult[]         — 图片搜索结果列表
```

### 2.5 联网搜索

#### websearch_search
```
描述：搜索公开网页并返回原始结果
参数：
  query: string (必填)           — 搜索查询文本
  count?: number                 — 最大结果数（默认 10，最大 50）
  time_range?: "day" | "week" | "month" | "year"  — 默认 "month"
  filter?: {
    domains?: string[]           — 仅包含的域名
    exclude_domains?: string[]   — 排除的域名
  }
  need_summary?: boolean         — 是否需要网页摘要
返回：
  results: WebResult[]           — 搜索结果
```

#### websearch_aisearch
```
描述：基于公开网页生成综合 AI 回答
参数：同上 websearch_search
返回：
  answer: string                 — AI 综合回答
  sources: WebSource[]           — 引用来源
```

### 2.6 技术文档查询

#### resolve-library-id
```
描述：解析开源库名称为 Context7 规范标识符
参数：
  libraryName: string (必填)     — 库名称，如 "React"
  query: string (必填)           — 用户的任务/问题描述
限制：每个问题最多调用 3 次
返回：
  results: {
    libraryId: string            — 格式 "/org/project" 或 "/org/project/version"
    name: string
    description: string
    codeSnippets: number
    sourceReputation: "High" | "Medium" | "Low" | "Unknown"
    benchmarkScore: number       — 0-100
    versions: string[]
  }[]
```

#### query-docs
```
描述：查询开源库的技术文档和代码示例
参数：
  libraryId: string (必填)       — Context7 标识符，如 "/facebook/react"
  query: string (必填)           — 具体查询问题
限制：每个问题最多调用 3 次
返回：
  content: string                — 文档内容和示例
  sources: DocSource[]           — 来源引用
```

### 2.7 安全上报

#### report_user_abuse
```
描述：上报用户违规行为给平台管理员
参数：
  abuse_detail: string (必填)    — 违规详情，包含：
    1. 用户输入摘要
    2. 触发的规则名称
    3. 违规行为描述
返回：
  reported: boolean              — 是否上报成功
  report_id: string              — 上报记录 ID
触发条件：
  - guardrail.md 中定义的任何违规行为
  - 禁止政治/历史话题
  - 禁止获取大模型 API Key
  - 禁止网络安全攻击
  - 禁止网络隧道/流量转发
  - 禁止灰产滥用
  - 禁止安装第三方 Agent
  - 禁止环境保活工具/网站面板
```

---

## 3. 技能间通信接口

### 3.1 需求文档格式 (requirements.md)

```typescript
interface RequirementsDocument {
  feature_name: string;               // kebab-case，如 "user-authentication"
  introduction: string;               // 功能概述
  glossary: Record<string, string>;   // 术语表
  requirements: Requirement[];
}

interface Requirement {
  id: number;
  user_story: string;                 // "AS [role], I want [feature], so that [benefit]"
  acceptance_criteria: EARSCriteria[];
}

interface EARSCriteria {
  id: number;
  pattern: "ubiquitous" | "event-driven" | "state-driven" | "unwanted-behavior" | "complex";
  definition: string;                 // EARS 规范表述
}
```

### 3.2 设计文档格式 (design.md)

```typescript
interface DesignDocument {
  feature_name: string;
  updated: string;                    // ISO 日期
  description: string;
  architecture: {
    diagram?: string;                 // Mermaid 图表
    explanation: string;
  };
  components: ComponentSpec[];
  data_models: DataModelSpec[];
  correctness_properties: string[];   // 不变式/约束
  error_handling: ErrorHandlingSpec[];
  test_strategy: TestStrategySpec[];
  references: Reference[];
}
```

### 3.3 任务列表格式 (tasklist.md)

```typescript
interface TaskList {
  feature_name: string;
  tasks: TaskItem[];
}

interface TaskItem {
  id: string;                         // 如 "1", "2.1", "3.2.1"
  title: string;                      // 任务标题
  checked: boolean;                   // [x] 或 [ ]
  optional: boolean;                  // 是否为可选（测试等）
  subtasks?: SubTask[];
  details: string[];                  // 实现说明
  references: string[];               // 关联的需求编号
}
```

---

## 4. 配置文件格式

### 4.1 opencode.json (完整 schema)

```typescript
interface OpenCodeConfig {
  snapshot: boolean;                   // 是否启用快照
  agent: { title: { disable: boolean } };
  model: string;                       // 默认模型，如 "monkeycode-ai/monkeycode-basic/qwen3.5-plus"
  provider: Record<string, LLMProvider>;
  disabled_providers: string[];
  instructions: string[];              // 规则文件 glob 路径
  skills: { paths: string[] };         // 技能目录路径
}

interface LLMProvider {
  npm: string;                         // SDK npm 包名
  name: string;
  options: {
    baseURL: string;                   // API 端点
    apiKey?: string;                   // 从环境变量读取
  };
  models: Record<string, {
    limit: { context: number; output: number };
  }>;
}
```

### 4.2 MEMORY.md 格式

```markdown
# 用户指令记忆

## 格式
### 用户指令条目
[摘要]
- Date: YYYY-MM-DD
- Context: [场景描述]
- Instructions:
  - [具体指令，逐行描述]

### 项目知识条目
[摘要]
- Date: YYYY-MM-DD
- Context: Agent 在执行 [任务描述] 时发现
- Category: [运维部署|构建方法|测试方法|排错调试|工作流协作|环境配置]
- Instructions:
  - [具体知识点，逐行描述]
```

---

## 5. 错误处理规范

### 5.1 MCP 工具错误码

| 错误码 | 含义 | 处理策略 |
|--------|------|---------|
| `TOOL_NOT_FOUND` | 工具不存在 | 检查工具名拼写 |
| `INVALID_PARAMS` | 参数校验失败 | 检查参数类型和必填项 |
| `EXECUTION_FAILED` | 工具执行异常 | 检查工具日志 |
| `TIMEOUT` | 操作超时 | 重试或增加超时 |
| `RATE_LIMITED` | 触发频率限制 | 退避重试 |
| `NETWORK_ERROR` | 网络不可达 | 检查服务可用性 |
| `PERMISSION_DENIED` | 权限不足 | 检查安全策略 |

### 5.2 技能执行错误

| 错误码 | 含义 | 处理策略 |
|--------|------|---------|
| `SKILL_NOT_FOUND` | 技能未注册 | 检查技能名和路径 |
| `SKILL_PARSE_ERROR` | SKILL.md 解析失败 | 检查 YAML frontmatter |
| `SKILL_EXECUTION_FAILED` | 技能工作流执行失败 | 回滚已执行步骤 |
| `SKILL_PRECONDITION_FAILED` | 前置条件不满足 | 提示用户补全依赖 |
| `SKILL_USER_ABORT` | 用户主动取消 | 清理中间状态 |

### 5.3 模型调用错误

| 错误码 | 含义 | 处理策略 |
|--------|------|---------|
| `MODEL_UNAVAILABLE` | 模型不可用 | 切换备用模型 |
| `CONTEXT_OVERFLOW` | 超出上下文窗口 | 缩减输入内容 |
| `OUTPUT_LIMIT` | 超出输出限制 | 分段请求 |
| `AUTH_FAILED` | 认证失败 | 检查 API Key（不输出真实值） |

---

## 6. 存储设计

| 数据 | 存储位置 | 格式 | TTL |
|------|---------|------|-----|
| 任务配置 | `/root/.codingmatrix/tasks/{task_id}.json` | JSON | 会话级 |
| 终端日志 | `/tmp/opencode/terminal_{id}.log` | 文本 | 会话级 |
| 项目文档 | `{workspace}/.monkeycode/docs/` | Markdown | 持久化 |
| 功能规格 | `{workspace}/.monkeycode/specs/` | Markdown | 持久化 |
| 用户记忆 | `{workspace}/.monkeycode/MEMORY.md` | Markdown | 持久化 |
| 规则文件 | `/root/.codingmatrix/project-tpl/.ai-ready/rules/` | Markdown | 平台级 |
| 技能文件 | `/root/.codingmatrix/project-tpl/.ai-ready/skills/` | Markdown | 平台级 |
| 运行时配置 | `/root/.config/opencode/opencode.json` | JSONC | 平台级 |
| 临时构建产物 | `/tmp/dist.zip`, `/tmp/Dockerfile` 等 | 文件 | 单次发布 |
| Git 凭据 | `/root/.netrc` | 文本 | 按需生成 |
