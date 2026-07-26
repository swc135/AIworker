# EARS 需求规范

EARS（Easy Approach to Requirements Syntax）是一种结构化的需求描述模板，用于编写清晰、无歧义的需求。

## 五种模式

### 1. Ubiquitous（无处不在型）
描述始终适用的系统行为。

**模板**：`The <system> SHALL <function>`

**示例**：系统 SHALL 提供用户登录功能。

### 2. Event-Driven（事件驱动型）
描述由特定事件触发的行为。

**模板**：`WHEN <trigger>, the <system> SHALL <function>`

**示例**：WHEN 用户点击"登录"按钮，系统 SHALL 验证用户凭证。

### 3. State-Driven（状态驱动型）
描述在特定状态下持续的行为。

**模板**：`WHILE <state>, the <system> SHALL <function>`

**示例**：WHILE 用户处于登录状态，系统 SHALL 显示仪表盘。

### 4. Unwanted-Behavior（不期望行为型）
描述对异常情况的响应。

**模板**：`IF <condition>, the <system> SHALL <function>`

**示例**：IF 密码连续输入错误 3 次，系统 SHALL 锁定账户 30 分钟。

### 5. Complex（复合型）
多条件组合。

**模板**：`[WHERE] [WHILE] [WHEN/IF] THE <system> SHALL <function>`
**子句顺序**：WHERE → WHILE → WHEN/IF → THE → SHALL

## INCOSE 语义质量规则

1. **主动语态** — 清晰说明谁做什么
2. **禁止模糊词汇** — 不使用"快速""充分""用户友好"等
3. **禁止逃脱条款** — 不使用"尽可能""如可行"
4. **禁止否定陈述** — 避免"SHALL NOT"（改为正面表述）
5. **每个需求一个概念** — 单一、可测试
6. **显式条件** — 可衡量的标准和阈值
7. **术语一致** — 使用术语表中定义的术语
8. **禁止代词** — 不使用"它""它们""这"
9. **禁止绝对化** — 不使用"从不""永远""100%"
10. **无方案绑定** — 关注"做什么"，非"怎么做"
