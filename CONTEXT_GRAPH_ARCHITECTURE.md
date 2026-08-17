# Modular Semantic Context Graph & Context Firewall

## 0. 项目目标

开发一个面向 AI Agent / DeepSeek Harness / Codex 等 Agent 的模块化 Context 系统。

核心目标不是简单管理聊天记录，也不是制作代码依赖可视化工具，而是：

> 将项目中的代码、功能、用户输入、需求、约束、决策、接口、测试、Issue、文档和对话统一建模为可连接的 Context，并在每次 LLM 请求前，只将当前任务真正需要的信息发送给模型。

最终实现：

```text
Raw Information
       ↓
Context Extraction
       ↓
Structured Context
       ↓
Semantic Functional Graph
       ↓
Context Compiler
       ↓
Context Policy
       ↓
Token Budget
       ↓
Context Firewall
       ↓
Selected Context
       ↓
DeepSeek / Codex / Other LLM
```

---

# 1. 最重要的原则

## 1.1 Conversation 不是最终 Context

传统 Agent：

```text
User
 ↓
Conversation History
 ↓
越来越长
 ↓
全部发送给 LLM
```

本项目必须改成：

```text
User Input
 ↓
Context Extraction
 ↓
Requirement
Task
Constraint
Decision
Issue
 ↓
Context Graph
 ↓
Context Compiler
 ↓
Relevant Context
 ↓
LLM
```

原始 Conversation 仍然保存，但它只是：

```text
Raw Source
```

而不是默认的最终 Context。

---

# 2. 核心问题

目前很多 Agent / Harness 会把：

```text
完整 conversation
+
workspace
+
代码
+
工具结果
+
历史信息
```

一起加入最终 Prompt。

这会导致：

1. Context 越来越长。
2. 无关模块污染当前任务。
3. Token 消耗过大。
4. Agent 注意力被无关内容分散。
5. 修改 A 模块时仍然加载 B/C 模块。
6. 老的错误决策可能影响当前任务。
7. 代码依赖递归导致 Context 爆炸。

本项目必须解决：

> **如何在最终发送给 LLM 之前真正裁剪 Context。**

---

# 3. Context Firewall

系统必须存在一个硬性的：

```text
Context Firewall
```

它位于：

```text
Agent / Harness
        ↓
Context Firewall
        ↓
LLM
```

Context Firewall 的作用：

> 没有被 Context Compiler 选中的信息，不允许自动进入最终 LLM Request。

架构：

```text
┌─────────────────────┐
│ Agent / Harness     │
│                     │
│ Conversation        │
│ Workspace           │
│ Files               │
│ Tools               │
└──────────┬──────────┘
           │
           │ Raw Context
           ▼
┌──────────────────────────┐
│    Context Firewall      │
│                          │
│ Context Extraction       │
│ Context Selection        │
│ Context Policy           │
│ Token Budget             │
│ Validation               │
└──────────┬───────────────┘
           │
           │ Selected Context
           ▼
┌─────────────────────┐
│ DeepSeek / LLM      │
└─────────────────────┘
```

---

# 4. 最关键的实现原则：重建 Context，而不是简单删除文本

不要实现：

```text
100000 tokens
 ↓
删除前面 30000 tokens
 ↓
剩余 70000 tokens
```

应该实现：

```text
Raw Context
 ↓
分析当前 Task
 ↓
重新选择 Context
 ↓
生成新的 Context
 ↓
发送给 LLM
```

例如当前任务：

```text
修改 ASR 时间戳
```

最终 Context：

```text
SYSTEM
Project Rules

TASK
修改 ASR 时间戳

FUNCTIONAL CONTEXT
ASR
Audio Input
Subtitle

REQUIREMENTS
字幕必须与视频同步

CONSTRAINTS
不能明显增加显存

DECISIONS
ASR 与 Speaker Recognition 解耦

INTERFACES
AudioStream → ASR
ASR → Transcript

RELEVANT CODE
asr.py
timestamp.py

RELEVANT TEST
test_asr_timestamp.py
```

而不是：

```text
整个项目
+
所有历史对话
+
所有文件
```

---

# 5. 三层 / 四层 Context 架构

推荐实现以下层级。

## L0：Identity Context

始终保留：

```text
Project
Agent Role
Current Task
Global Rules
Critical System Instructions
```

---

## L1：Semantic Context

主要来自 Context Graph：

```text
Requirements
Constraints
Decisions
Tasks
Issues
Functional Modules
Interfaces
Architecture Rules
```

---

## L2：Implementation Context

只加载相关代码：

```text
Files
Classes
Functions
Methods
Tests
Relevant Symbols
```

---

## L3：On-Demand Context

只有 Agent 明确需要时才加载：

```text
完整文件
旧 Conversation
Logs
其他模块
历史实现
大型文档
```

---

# 6. Context Node

所有工程知识统一抽象成：

```text
ContextNode
```

至少支持：

```text
CodeModule
FunctionalModule
Requirement
Task
Constraint
Decision
Interface
Documentation
Conversation
Artifact
Test
Issue
Note
ProjectRule
```

推荐基础结构：

```json
{
  "id": "unique_id",
  "type": "requirement",
  "title": "Use H.265",
  "content": "Video recording must use H.265.",
  "source": "user",
  "priority": "high",
  "status": "active",
  "confidence": 1.0,
  "created_at": "...",
  "updated_at": "...",
  "metadata": {}
}
```

---

# 7. Context Edge

Context Node 之间通过 Edge 建立关系。

至少支持：

```text
depends_on
calls
references
affects
constrains
implements
derived_from
conflicts_with
supersedes
related_to
contains
uses
produces
tests
documents
provides
consumes
feeds
transforms
triggers
```

例如：

```text
Requirement
    │
    └── affects ──→ ASR
```

```text
Constraint
    │
    └── constrains ──→ Subtitle
```

```text
Decision
    │
    └── applies_to ──→ Speaker Recognition
```

---

# 8. 用户输入必须模块化

例如用户输入：

```text
我要增加双主播支持，并且不能明显增加显存占用。
```

系统应提取：

```text
Requirement:
支持双主播

Constraint:
不能明显增加显存占用
```

建立：

```text
Requirement → affects → ASR
Requirement → affects → Speaker Recognition
Constraint → constrains → ASR
Constraint → constrains → Speaker Recognition
```

如果无法确定目标：

```text
target = unknown
confidence < threshold
```

不要强行建立错误关系。

---

# 9. AI 输出也必须模块化

例如 AI：

```text
ASR 和 Speaker Recognition 应保持独立，因为双主播需要分别识别。
```

应该提取：

```text
Decision:

ASR 与 Speaker Recognition 保持独立。

Reason:

双主播需要分别识别。
```

并建立：

```text
Decision → applies_to → ASR
Decision → applies_to → Speaker Recognition
```

原始 AI 回复仍然保留：

```text
Decision
    │
    └── derived_from → AssistantMessage
```

---

# 10. Requirement / Decision 必须可追溯

例如：

```text
Requirement R001
```

必须能够追溯：

```text
Requirement R001
       ↓
derived_from
       ↓
UserMessage #456
       ↓
Conversation #123
```

这样可以回答：

> 这个需求是从哪句话来的？

---

# 11. Requirement Evolution

需求会变化。

例如：

```text
R001:
使用 H.264
```

后来：

```text
R002:
改成 H.265
```

不要删除 R001。

建立：

```text
R002
 │
 └── supersedes ──→ R001
```

状态：

```text
R001 = superseded
R002 = active
```

---

# 12. Conflict Detection

例如：

```text
R001:
使用 H.264

R002:
使用 H.265
```

检测：

```text
R001 conflicts_with R002
```

如果用户确认：

```text
R002 supersedes R001
```

必须保留历史，而不是覆盖原始数据。

---

# 13. Task Node

当前用户行为必须能够形成 Task。

例如：

```text
修改 Recorder
```

产生：

```text
Task T001

target:
Recorder

goal:
修改 Recorder
```

Task 可以连接：

```text
Task
 ├── targets → FunctionalModule
 ├── requires → Requirement
 ├── constrained_by → Constraint
 ├── related_to → Issue
 └── affected_by → Decision
```

---

# 14. 最核心的 Graph：Functional Graph

默认 Graph 不应该展示代码文件之间的调用关系。

错误：

```text
capture.py
 ↓
video_manager.py
 ↓
recorder.py
 ↓
encoder.py
```

正确：

```text
Video Capture
      │
      ▼
Video Recording
      │
      ▼
Video Encoding
```

Functional Graph 描述：

> 系统做什么。

Implementation Graph 描述：

> 代码怎么实现。

---

# 15. Functional Node

Functional Node 表示：

```text
功能
能力
模块
子系统
服务
数据处理阶段
```

例如：

```text
Video Capture
Video Recording
Video Encoding
Audio Capture
ASR
Speaker Recognition
Subtitle
Timestamp Synchronization
```

不要把每个函数都变成功能节点。

错误：

```text
parse_audio()
normalize_audio()
get_timestamp()
append_buffer()
```

正确：

```text
ASR
Timestamp Synchronization
Audio Processing
```

---

# 16. Functional Node 必须描述能力

例如：

```yaml
id: function.asr

type: functional

name: ASR

description: >
  Converts speech audio into timestamped text.

provides:
  - transcription
  - timestamps

consumes:
  - audio_stream

input:
  - AudioStream

output:
  - Transcript
```

UI：

```text
┌─────────────────────────────┐
│ ASR                         │
├─────────────────────────────┤
│ Speech → Text               │
│                             │
│ Input:  AudioStream         │
│ Output: Transcript          │
│                             │
│ Provides:                   │
│ • Transcription             │
│ • Timestamp                 │
└─────────────────────────────┘
```

---

# 17. Functional Edge

Functional Graph 只使用高层语义关系：

```text
provides
consumes
depends_on
produces
affects
constrains
implements
feeds
transforms
triggers
related_to
```

例如：

```text
Audio Capture
      │
      │ provides
      ▼
ASR
      │
      │ produces
      ▼
Transcript
```

---

# 18. Implementation Graph

Implementation Graph 保存真实代码结构：

```text
File
Class
Function
Method
Package
Symbol
```

以及：

```text
import
call
reference
inheritance
data flow
dependency
```

例如：

```text
ASR
│
└── Implementation
    ├── asr.py
    ├── whisper.py
    ├── decoder.py
    └── timestamp.py
```

这些默认隐藏。

---

# 19. Functional Graph 与 Implementation Graph 必须严格分离

系统内部：

```text
Functional Graph
        │
        │ implemented_by
        ▼
Implementation Graph
```

不能变成：

```text
Functional Graph = Implementation Graph
```

一个 Functional Node 可以对应多个文件：

```text
ASR
 ├── asr.py
 ├── whisper.py
 ├── decoder.py
 └── timestamp.py
```

一个文件也可以实现多个 Functional Node：

```text
pipeline.py
 ├── Audio Routing
 ├── Timestamp Synchronization
 └── Stream Management
```

因此不能假设：

```text
1 Functional Node = 1 File
```

---

# 20. UI 默认只显示 Functional Graph

默认：

```text
SHOW:
✓ Functional Nodes
✓ Context Nodes
✓ Semantic Edges
✓ Requirements
✓ Constraints
✓ Decisions
✓ Interfaces

HIDE:
✗ Files
✗ Classes
✗ Functions
✗ Imports
✗ Calls
✗ AST
✗ Internal Dependencies
```

---

# 21. Implementation 必须支持主动展开

用户点击：

```text
ASR
```

显示：

```text
ASR
│
└── Implementation
    ├── asr.py
    ├── whisper.py
    ├── decoder.py
    └── timestamp.py
```

进一步点击文件才显示：

```text
Functions
Classes
Methods
Calls
Dependencies
```

采用渐进式展开：

```text
Functional Graph
       ↓
Implementation Graph
       ↓
Code Detail
```

---

# 22. 三种 Graph View

至少支持：

## Semantic View

默认：

```text
Functional Nodes
Context Nodes
Semantic Edges
```

---

## Implementation View

显示：

```text
Files
Classes
Functions
Calls
Imports
Dependencies
```

---

## Context View

只显示当前 Task 相关内容：

```text
Task
Requirement
Constraint
Decision
Functional Modules
Relevant Implementation
Tests
```

---

# 23. Functional Graph 层级

支持：

```text
Project
  ↓
Subsystem
  ↓
Module
  ↓
Capability
```

例如：

```text
Multimedia System
   │
   ├── Video
   │    ├── Capture
   │    ├── Recording
   │    └── Encoding
   │
   └── Audio
        ├── Capture
        ├── ASR
        └── Speaker Recognition
```

---

# 24. Zoom Level

支持不同抽象层：

### Level 0

```text
Video
Audio
Subtitle
```

### Level 1

```text
Video Capture
Video Recording
Audio Capture
ASR
Speaker Recognition
Subtitle
```

### Level 2

允许进入 Implementation：

```text
ASR
 ↓
asr.py
whisper.py
timestamp.py
```

---

# 25. Functional Node 自动推断

增加：

```text
infer_functional_modules()
```

输入：

```text
Implementation Graph
+
README
+
Documentation
+
Context Nodes
+
User-defined Modules
```

输出：

```text
Functional Nodes
Functional Edges
Implementation Mapping
```

例如：

```text
asr.py
whisper.py
decoder.py
timestamp.py
```

推断：

```text
ASR
```

而不是四个功能节点。

---

# 26. AI 推断必须有 Evidence

例如：

```json
{
  "functional": "ASR",
  "evidence": [
    "src/asr/asr.py",
    "src/asr/whisper.py",
    "src/asr/decoder.py"
  ],
  "confidence": 0.91,
  "created_by": "ai"
}
```

用户可以：

```text
Accept
Edit
Reject
Merge
Split
```

---

# 27. Functional Node Merge / Split

支持：

```text
Merge
Split
Rename
Move
Reclassify
```

例如：

```text
Audio Processing
ASR
Timestamp Processing
```

用户认为：

```text
Timestamp Processing
```

属于：

```text
ASR
```

可以 Merge。

反过来：

```text
ASR
```

太大，可以 Split：

```text
Speech Recognition
Timestamp Processing
```

---

# 28. 修改 Functional Node 不应该直接修改代码

用户把：

```text
ASR
```

改名：

```text
Speech Recognition
```

只修改 Semantic Layer。

不要自动修改：

```text
asr.py
```

除非用户明确执行代码重构。

---

# 29. Dependency Analysis 的定位

Dependency Skill 继续分析：

```text
import
call
reference
inheritance
data flow
```

但是这些结果只属于：

```text
Implementation Graph
```

不能直接变成 Functional Graph。

正确流程：

```text
Code
 ↓
Dependency Analysis
 ↓
Implementation Graph
 ↓
Functional Inference
 ↓
Functional Graph
```

---

# 30. Context Compiler

Context Compiler 是整个系统核心。

它负责：

> 从 Context Graph 中生成当前 LLM Request 真正需要的 Context。

输入：

```text
Current Task
Context Graph
Functional Graph
Implementation Graph
Context Policy
Token Budget
User Overrides
```

输出：

```text
Selected Context
```

---

# 31. Context Compiler 必须从 Task 开始

例如：

```text
当前 Task：
修改 ASR 的时间戳。
```

流程：

```text
Task
 ↓
ASR Functional Node
 ↓
Timestamp Capability
 ↓
Relevant Requirements
 ↓
Relevant Constraints
 ↓
Relevant Decisions
 ↓
Relevant Interfaces
 ↓
Relevant Tests
 ↓
Functional → Implementation Mapping
 ↓
Relevant Symbols / Code
```

---

# 32. 不允许简单使用文件依赖 BFS

错误：

```text
ASR
 ↓
decoder.py
 ↓
utils.py
 ↓
logger.py
 ↓
config.py
 ↓
...
```

正确：

```text
Task
 ↓
Functional Graph
 ↓
Semantic Relevance
 ↓
Relevant Capability
 ↓
Implementation Mapping
 ↓
Relevant Code
```

---

# 33. Graph Traversal 必须有限制

不能无限 BFS。

例如：

```yaml
context_policy:

  functional_dependencies:
    depth: 2

  requirements:
    required: true

  constraints:
    required: true

  interfaces:
    depth: 2

  implementation:
    depth: 1

  tests:
    depth: 1

  conversation:
    enabled: false

  logs:
    enabled: false
```

不同关系可以使用不同 depth。

---

# 34. Context Selection

每个 Context 可以计算相关性：

```text
score =
    task_relevance
  + graph_distance
  + semantic_similarity
  + dependency_relevance
  + priority
  + recency
  + explicit_user_weight
```

例如：

```text
ASR timestamp.py       0.98
ASR interface          0.97
Timestamp requirement  0.96
ASR test                0.93
Audio Capture           0.78
Speaker                 0.31
UI                      0.05
Old conversation        0.01
```

---

# 35. Hard / Soft / Optional Context

## Hard Context

必须保留：

```text
System Rules
Active Requirements
Active Constraints
Relevant Interfaces
Explicit User Instructions
Critical Architecture Decisions
```

## Soft Context

按相关性选择：

```text
Documentation
Code
Tests
Historical Decisions
Relevant Conversation
```

## Optional Context

Token 不足时删除：

```text
Old Conversation
Debug Logs
Repeated Explanations
Redundant Documentation
```

---

# 36. Context Budget

必须增加 Token Budget Manager。

例如：

```text
Total Budget = 64k
```

分配：

```text
System                 5k
Task                   2k
Requirements           3k
Constraints            2k
Decisions              3k
Functional Graph       3k
Interfaces             5k
Code                  30k
Tests                  5k
Reserve                6k
```

必须防止：

```text
Code
```

把整个 Context Budget 吃完。

---

# 37. Context Manifest

每次 Context Compiler 都应该生成 Manifest。

例如：

```json
{
  "task": "modify_asr_timestamp",
  "budget": 64000,

  "included": [
    "task:001",
    "requirement:003",
    "constraint:002",
    "decision:007",
    "function:asr",
    "function:audio",
    "interface:audio_stream",
    "impl:timestamp.py",
    "test:test_asr_timestamp"
  ],

  "excluded": [
    "function:ui",
    "function:database",
    "conversation:001-120",
    "logs:old"
  ],

  "reasons": {
    "function:asr": "current task target",
    "impl:timestamp.py": "implements timestamp capability",
    "function:ui": "unrelated"
  }
}
```

Manifest 必须支持：

```text
Included
Excluded
Reason
Score
Token Cost
Source
```

---

# 38. Context Preview

在真正发送给 LLM 前，必须提供 Preview：

```text
Context Preview

Task
✓ Modify ASR timestamp

Functional Context
✓ ASR
✓ Audio Input
✓ Subtitle

Requirements
✓ Timestamp must remain synchronized

Constraints
✓ Low memory overhead

Decisions
✓ ASR and Speaker Recognition remain independent

Implementation
✓ src/asr/timestamp.py
✓ src/asr/asr.py

Excluded
✗ src/speaker/*
✗ UI
✗ Database
✗ Old Conversations

Estimated Tokens: 31,420
```

用户应该可以修改：

```text
Include
Exclude
Force Include
Force Exclude
```

---

# 39. Force Include / Force Exclude

支持：

```text
auto
manual
force_include
force_exclude
```

例如：

```text
ASR
 ├── Audio [auto]
 ├── Speaker [auto]
 └── Speaker Interface [force_include]
```

用户：

```text
修改 ASR，同时参考 Speaker Interface。
```

必须加入。

如果用户：

```text
不要加载 UI。
```

则：

```text
UI [force_exclude]
```

即使自动算法认为 UI 有关，也必须排除。

---

# 40. 用户手动连接

用户可以：

```text
Requirement
      │
      └── affects → ASR
```

手动关系优先于自动推断。

所有手动 Edge 必须持久化。

---

# 41. On-Demand Context

不要让初始 Context 无限膨胀。

允许 Agent 请求额外 Context：

```text
AI
 ↓
Current Context
 ↓
Need Speaker Interface
 ↓
request_context(
    "function:speaker",
    scope="interface"
)
 ↓
Context Provider
 ↓
Speaker Interface
 ↓
AI
```

因此：

```text
Initial Context
       ↓
      LLM
       ↓
Need More?
   /       \
 No         Yes
 ↓           ↓
Execute   Context Request
             ↓
       Context Provider
             ↓
             LLM
```

Context 从：

```text
主动灌输
```

转变为：

```text
按需获取
```

---

# 42. Context Request API

设计类似：

```json
{
  "type": "context_request",
  "target": "function.speaker",
  "scope": [
    "interface"
  ],
  "reason": "Need to understand ASR/Speaker integration",
  "max_tokens": 3000
}
```

Provider 返回：

```json
{
  "context": [
    "speaker.interface",
    "speaker.contract"
  ],
  "tokens": 1800
}
```

---

# 43. Code Context 必须尽量 Symbol Level

不要把整个：

```text
timestamp.py
```

都加入 Context。

应该进一步分析：

```text
timestamp.py
├── TimestampAligner
│   ├── align()
│   └── normalize()
├── TimestampBuffer
│   └── append()
└── helper()
```

当前 Task：

```text
修改 TimestampAligner.align()
```

优先加载：

```text
align()
相关调用方
相关 interface
相关 tests
相关 requirements
```

而不是整个文件。

---

# 44. Implementation Context Selection

代码选择优先级：

```text
Relevant Symbol
 ↓
Containing Class
 ↓
Direct Callers
 ↓
Direct Dependencies
 ↓
Relevant Tests
 ↓
Relevant File Sections
```

不要默认加载整个 repository。

---

# 45. Conversation 压缩

长 Conversation：

```text
50 turns
50000 tokens
```

应沉淀成：

```text
Requirement
Constraint
Decision
Task
Issue
```

例如：

```text
Requirement:
支持双主播

Constraint:
显存 < 8GB

Decision:
ASR 与 Speaker 分离

Decision:
共享音频流

Task:
修改 Speaker Tracking
```

可能只需要：

```text
500 tokens
```

原始 Conversation 保留在 Raw Layer。

默认：

```text
conversation.enabled = false
```

只有：

```text
需要追溯
或者
Structured Context 信息不足
```

时才加载。

---

# 46. Context Extraction Skill

增加：

```text
skills/context-extraction/
```

负责：

```text
Raw Conversation
 ↓
Task
Requirement
Constraint
Decision
Issue
Question
Reference
```

要求：

1. 不凭空创造需求。
2. 不确定时降低 confidence。
3. 必须记录 source。
4. 必须记录 derived_from。
5. 支持用户确认。
6. 支持 supersedes。
7. 支持 conflict detection。

---

# 47. 推荐 Skill 架构

```text
skills/
├── module-discovery/
├── dependency-analysis/
├── interface-contract/
├── context-extraction/
├── context-routing/
├── context-maintenance/
├── context-compiler/
└── context-firewall/
```

职责：

```text
module-discovery
    ↓
发现代码模块

dependency-analysis
    ↓
生成 Implementation Graph

interface-contract
    ↓
提取模块接口

context-extraction
    ↓
将用户输入 / AI 输出转换成 Context

context-routing
    ↓
决定 Context Node 如何连接

context-maintenance
    ↓
维护 Context Graph

context-compiler
    ↓
生成最终 LLM Context

context-firewall
    ↓
阻止未授权 Context 进入最终 Request
```

---

# 48. Context Policy

增加独立 Policy 层。

例如：

```yaml
context_policy:

  task:
    required: true

  requirements:
    required: true
    status: active

  constraints:
    required: true

  decisions:
    max_age: 30d

  functional_dependencies:
    depth: 2

  interfaces:
    depth: 2

  implementation:
    depth: 1

  tests:
    depth: 1

  conversation:
    enabled: false

  raw_logs:
    enabled: false
```

Context Graph 决定：

> 什么可能相关。

Context Policy 决定：

> 什么允许进入。

---

# 49. Context Firewall 必须是真正的硬边界

这是整个项目最重要的工程要求。

如果 Context Compiler 生成：

```text
Selected Context
```

但是 DeepSeek Harness 又自动把：

```text
完整 Conversation
完整 Workspace
```

加入最终 Request，

那么：

```text
Context Compiler
```

实际上没有达到裁剪目的。

因此必须控制：

> **最终发送给 DeepSeek API 的 Request Payload。**

---

# 50. 必须确认 Harness 的 Context Assembly 权限

开发时首先调查：

```text
DeepSeek Harness
 ↓
最终 Prompt / Request
 ↓
在哪里组装？
```

需要找到：

```text
system prompt
conversation history
workspace context
tool results
file context
user input
```

最终合并的位置。

如果可以修改：

```text
Context Assembly Layer
```

就在这里接入：

```text
Context Firewall
```

如果 Harness 本身无法控制最终 Payload：

```text
Harness
 ↓
无法阻止自动 Context
```

则必须增加：

```text
Agent / Context Proxy
 ↓
DeepSeek API
```

或者修改 Harness 的 Context Assembly 层。

---

# 51. 不要只在 UI 层裁剪

错误：

```text
UI 隐藏 B/C
```

但是内部 Request 仍然：

```text
A + B + C + Conversation
```

这种方式没有实际效果。

正确：

```text
UI Graph
     ↓
Context Compiler
     ↓
Context Manifest
     ↓
Context Firewall
     ↓
Final API Request
```

最终 API Request 中不存在被排除的 Context。

---

# 52. Final Request 必须可审计

开发 Debug Mode：

```text
REQUEST CONTEXT AUDIT

Total Raw Context:
1,240,000 tokens

Candidate Context:
320,000 tokens

Selected Context:
58,400 tokens

Excluded:
1,181,600 tokens

Final Request:
61,200 tokens
```

并列出：

```text
Included:
ASR
Timestamp
Requirement R12
Constraint C4
timestamp.py
test_asr.py

Excluded:
UI
Database
Speaker Implementation
Old Conversation
Debug Logs
```

---

# 53. Context Firewall Validation

发送请求前必须执行：

```text
validate_context()
```

检查：

1. 是否超过 Token Budget。
2. 是否包含 Force Exclude。
3. 是否缺少 Hard Context。
4. 是否存在重复 Context。
5. 是否存在过期 Requirement。
6. 是否存在 superseded Requirement。
7. 是否包含未经授权的 Raw Conversation。
8. 是否包含无关大文件。
9. 是否包含整个 workspace。
10. 是否符合 Context Policy。

失败时：

```text
BLOCK REQUEST
```

不要静默发送。

---

# 54. Context Deduplication

如果：

```text
Requirement
```

已经被结构化提取，

则不应该同时发送：

```text
原始 Conversation
```

除非明确需要。

避免：

```text
Requirement:
H.265

Conversation:
我要把视频改成 H.265...

Decision:
使用 H.265...
```

重复三次。

应该优先：

```text
Structured Requirement
```

---

# 55. Context Compression

可以压缩：

```text
Old Conversation
Old Decisions
Documentation
Repeated Explanations
Large Logs
```

但不要压缩：

```text
Critical Requirement
Critical Constraint
Interface Contract
Safety Rule
Current Task
Explicit User Instruction
```

---

# 56. Context Cache

可以对：

```text
Functional Graph
Implementation Graph
Requirements
Interfaces
Decisions
```

建立缓存。

例如：

```text
Project Graph Cache
```

用户修改代码后只增量更新：

```text
Changed Files
 ↓
Dependency Update
 ↓
Affected Functional Nodes
 ↓
Context Graph Update
```

不要每次重新分析整个项目。

---

# 57. Context Invalidation

当代码变化：

```text
timestamp.py changed
```

检查：

```text
ASR
Timestamp
Subtitle
```

相关 Context 是否失效。

例如：

```text
Interface I001
```

如果代码接口发生变化：

```text
status = stale
```

需要重新分析。

---

# 58. Context Provenance

所有 Structured Context 必须记录：

```text
source
created_by
confidence
derived_from
last_verified
```

例如：

```json
{
  "id": "decision.001",
  "type": "decision",
  "content": "ASR and Speaker remain independent",
  "source": "assistant",
  "created_by": "ai",
  "confidence": 0.91,
  "derived_from": [
    "conversation.123.message.456"
  ],
  "last_verified": "2026-08-17"
}
```

---

# 59. 用户可以查看为什么 Context 被加入

点击：

```text
timestamp.py
```

显示：

```text
Why included?

Current Task:
Modify ASR timestamp

Functional relation:
timestamp.py implements ASR.Timestamp

Requirement:
Timestamp must remain synchronized

Confidence:
0.98
```

点击：

```text
UI
```

显示：

```text
Why excluded?

No semantic relationship to current task.
Excluded by Context Policy.
```

---

# 60. 最终 UI

主界面应该类似：

```text
┌───────────────────────────────────────────────┐
│ Semantic Context Graph                       │
│                                               │
│              Requirement                     │
│                   │                           │
│                 affects                       │
│                   ▼                           │
│              ┌────────┐                       │
│              │  ASR   │                       │
│              └───┬────┘                       │
│                  │                            │
│             produces                         │
│                  ▼                            │
│             Transcript                        │
│                                               │
│ Audio ─────→ ASR ─────→ Subtitle              │
│                                               │
└───────────────────────────────────────────────┘
```

默认完全不出现：

```text
asr.py
whisper.py
decoder.py
```

点击 ASR：

```text
ASR
 ↓
Implementation
 ↓
asr.py
whisper.py
timestamp.py
```

---

# 61. 最终整体架构

```text
                           PROJECT
                              │
             ┌────────────────┴────────────────┐
             │                                 │
             ▼                                 ▼
        RAW CONTEXT                         SOURCE CODE
             │                                 │
             ▼                                 ▼
   CONTEXT EXTRACTION                DEPENDENCY ANALYSIS
             │                                 │
             ▼                                 ▼
   STRUCTURED CONTEXT              IMPLEMENTATION GRAPH
             │                                 │
             └────────────────┬────────────────┘
                              ▼
                    FUNCTIONAL INFERENCE
                              │
                              ▼
                 ┌────────────────────────┐
                 │  FUNCTIONAL GRAPH      │
                 │                        │
                 │ Modules                │
                 │ Capabilities           │
                 │ Interfaces             │
                 │ Semantic Relations     │
                 └───────────┬────────────┘
                             │
                             ▼
                    CONTEXT COMPILER
                             │
                  ┌──────────┴──────────┐
                  ▼                     ▼
            CONTEXT POLICY         TOKEN BUDGET
                  │                     │
                  └──────────┬──────────┘
                             ▼
                    CONTEXT MANIFEST
                             │
                             ▼
                    CONTEXT FIREWALL
                             │
                             ▼
                     FINAL LLM REQUEST
                             │
                             ▼
                    DeepSeek / Codex
```

---

# 62. 最终 Context 生成逻辑

伪代码：

```python
def build_context(task):

    candidates = discover_candidates(task)

    semantic_candidates = traverse_functional_graph(
        task,
        candidates
    )

    context_nodes = collect_context_nodes(
        task,
        semantic_candidates
    )

    implementation = resolve_implementation(
        semantic_candidates
    )

    candidates = merge(
        context_nodes,
        implementation
    )

    candidates = apply_user_overrides(
        candidates
    )

    candidates = apply_context_policy(
        candidates
    )

    candidates = rank_by_relevance(
        candidates,
        task
    )

    selected = allocate_token_budget(
        candidates
    )

    manifest = build_manifest(
        selected,
        candidates
    )

    validate_context(
        selected,
        manifest
    )

    return selected, manifest
```

---

# 63. Final Request

最终发送给 LLM 的内容应该类似：

```text
<SYSTEM>
Project rules...
</SYSTEM>

<TASK>
Modify ASR timestamp handling.
</TASK>

<REQUIREMENTS>
R003:
Subtitle timestamps must remain synchronized.
</REQUIREMENTS>

<CONSTRAINTS>
C002:
Memory usage should not significantly increase.
</CONSTRAINTS>

<DECISIONS>
D004:
ASR and Speaker Recognition remain independent.
</DECISIONS>

<FUNCTIONAL_CONTEXT>
ASR
Audio Input
Subtitle
</FUNCTIONAL_CONTEXT>

<INTERFACES>
AudioStream -> ASR
ASR -> Transcript
</INTERFACES>

<RELEVANT_IMPLEMENTATION>
src/asr/asr.py
src/asr/timestamp.py
</RELEVANT_IMPLEMENTATION>

<RELEVANT_TESTS>
tests/test_asr_timestamp.py
</RELEVANT_TESTS>

<CONTEXT_POLICY>
Speaker implementation and UI implementation are intentionally excluded.
Request additional context if required.
</CONTEXT_POLICY>
```

不要发送：

```text
全部聊天记录
全部 workspace
全部代码
全部 dependency graph
全部日志
```

---

# 64. Agent 可以主动请求更多 Context

模型如果发现：

```text
需要 Speaker Interface
```

可以发送：

```json
{
  "type": "context_request",
  "target": "function.speaker",
  "scope": ["interface"],
  "reason": "Need to understand ASR/Speaker integration",
  "max_tokens": 3000
}
```

Context Provider 返回：

```text
Speaker Interface
Speaker Contract
Relevant Documentation
```

然后追加到当前 Context。

---

# 65. 最终设计思想

整个系统最终应该遵循：

```text
代码 = HOW
功能 = WHAT
需求 = WHY
约束 = LIMIT
决策 = KNOWLEDGE
接口 = CONTRACT
对话 = RAW SOURCE
```

然后：

```text
Functional Graph
        ↓
Semantic Relevance
        ↓
Context Compiler
        ↓
Implementation Mapping
        ↓
Relevant Code
```

---

# 66. 最重要的产品定位

不要把项目实现成：

```text
❌ 聊天历史管理器
❌ 文件依赖可视化器
❌ 自动删除旧 Prompt
❌ 简单 Token 截断器
```

而应该实现成：

```text
Semantic Context Graph
+
Context Compiler
+
Context Firewall
+
On-Demand Context Provider
```

最终成为：

> 一个能够理解“当前任务需要哪些工程知识”，并在真正发送 LLM 请求前主动裁剪 Context 的 Agent Context Infrastructure。

---

# 67. 第一阶段开发优先级

必须按以下顺序实现：

```text
1. ContextNode
2. ContextEdge
3. FunctionalNode
4. ImplementationNode
5. Functional → Implementation Mapping
6. Context Graph Storage
7. Context Extraction
8. Functional Inference
9. Context Compiler
10. Context Policy
11. Token Budget Manager
12. Context Manifest
13. Context Preview
14. Force Include / Exclude
15. Context Firewall
16. Final Request Interception
17. On-Demand Context Request
18. Symbol-level Code Context
19. Context Cache
20. Context Invalidation
```

---

# 68. 第一阶段不要过度追求 AI 自动化

首先确保：

```text
用户手动创建 Functional Node
用户手动连接 Edge
用户手动 Force Include
用户手动 Force Exclude
Context Compiler 能正确裁剪
Context Firewall 能真正阻止 Context 进入最终 Request
```

这些必须先可靠。

之后再加入：

```text
AI Functional Inference
AI Context Extraction
AI Relationship Inference
AI Context Ranking
```

---

# 69. 验收测试

## Test 1：A/B/C 模块隔离

工程：

```text
A
B
C
```

A、B、C 没有互相调用，只共享上层接口。

当前任务：

```text
修改 A
```

最终 Context：

```text
A
A interface
Relevant requirements
Relevant tests
```

不得自动加载：

```text
B
C
B conversation
C conversation
```

---

## Test 2：存在 B/C 依赖但接口足够

```text
A → B
A → C
```

如果：

```text
B.md
C.md
```

已经明确描述：

```text
接口
输入
输出
Contract
```

修改 A 时：

优先加载：

```text
B Interface
C Interface
```

而不是：

```text
B 全部代码
C 全部代码
```

---

## Test 3：需要 B 内部实现时再展开

如果 Agent 判断：

```text
B interface 不足
```

才：

```text
request_context(B, scope="implementation")
```

然后加载 B 的相关实现。

---

## Test 4：长 Conversation

输入：

```text
100 轮对话
```

如果其中只有：

```text
3 个 Requirement
2 个 Constraint
1 个 Decision
```

最终 Context 默认只发送这些 Structured Context。

Raw Conversation 不进入。

---

## Test 5：Functional Graph

代码：

```text
20 个文件
```

如果实际只有：

```text
ASR
```

一个功能：

Functional Graph 只显示：

```text
ASR
```

而不是：

```text
20 个文件节点
```

---

## Test 6：Implementation 展开

点击：

```text
ASR
```

才看到：

```text
asr.py
whisper.py
timestamp.py
```

---

## Test 7：Context Budget

设置：

```text
64k
```

必须保证：

```text
Final Context <= 64k
```

并保留 Hard Context。

---

## Test 8：Force Exclude

用户：

```text
不要加载 Speaker。
```

即使：

```text
ASR → Speaker
```

存在依赖，也必须遵守：

```text
Speaker = excluded
```

除非系统判断该排除会导致任务无法执行，并明确向用户请求。

---

## Test 9：Force Include

用户：

```text
修改 ASR 时参考 Speaker Interface。
```

必须：

```text
Speaker Interface = included
```

---

## Test 10：Final Request Audit

必须能够看到：

```text
Raw Context:
1.2M tokens

Candidate:
320k

Selected:
58k

Excluded:
1.14M

Final Request:
61k
```

---

# 70. 最终验收条件

这个项目只有在以下条件全部满足时，才算完成核心功能：

```text
[ ] 用户输入可以转换成 Context Node
[ ] AI 输出可以转换成 Context Node
[ ] Requirement / Constraint / Decision 可追溯
[ ] Requirement 支持 supersedes
[ ] Context Graph 支持手动 Edge
[ ] Functional Graph 与 Implementation Graph 分离
[ ] 默认 Graph 不显示文件调用关系
[ ] Functional Node 可以映射多个文件
[ ] 文件可以映射多个 Functional Node
[ ] Context Compiler 从 Functional Graph 开始选择 Context
[ ] 不使用无限文件 BFS
[ ] 支持 Hard / Soft / Optional Context
[ ] 支持 Token Budget
[ ] 支持 Force Include
[ ] 支持 Force Exclude
[ ] 支持 Context Preview
[ ] 支持 Context Manifest
[ ] 支持 On-Demand Context
[ ] 支持 Symbol-level Code Context
[ ] 支持 Context Cache
[ ] 支持 Context Invalidation
[ ] 最终 API Request 可以被拦截
[ ] 未选择的 Context 不会偷偷进入最终 Request
[ ] Final Request 可以审计
```

---

# 71. 最终核心原则

整个系统最重要的一句话：

> **不要试图把所有工程信息都塞给 AI，然后让 AI 自己忽略无关内容；应该在 AI 收到请求之前，由 Context Compiler 根据任务、功能图、需求、约束、接口和依赖关系主动构建一个最小但足够的 Context。**

最终：

```text
                    Project Knowledge
                           │
                           ▼
                    Context Graph
                           │
                           ▼
                     Current Task
                           │
                           ▼
                  Semantic Selection
                           │
                           ▼
                   Context Compiler
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
        Context Policy              Token Budget
             │                           │
             └─────────────┬─────────────┘
                           ▼
                  Context Firewall
                           │
                           ▼
                    Final LLM Request
                           │
                           ▼
                     DeepSeek / Agent
```

**核心不是“让 AI 记住更多”，而是“让 AI 在正确的时间只看到正确的信息”。**
