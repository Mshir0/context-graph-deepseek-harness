# Context Graph for DeepSeek Harness

这是一个由 **DeepSeek Harness (`dsh`) 直接加载的 Cordis Host + Client 插件**，不是独立软件，也不会启动额外网页、模型客户端或 Web 服务。图编辑器作为 Harness 对话区域的原生视图标签。

插件使用 DSH 的 Agent 生命周期、工具注册表、Session workspace 和共享 Web Server：

```text
DSH user message
      ↓
agent/pre-step
      ↓
Semantic Functional Graph + Implementation Graph + manual overrides
      ↓
Context Compiler
      ↓
Context Manifest + validation
      ↓
Context Firewall / Session Surface replacement
      ↓
DSH model adapter (DeepSeek / other configured provider)
```

## 安装到 DeepSeek Harness

要求：

- DeepSeek Harness `0.1.0-rc.6` 或更新的 `0.1.x` 版本
- Node.js `^22.19.0` 或 `>=24`
- Python 3（完整 Python AST 分析；没有 Python 时会使用轻量回退分析）

如果已经克隆 DeepSeek Harness，请在 Harness 工程目录中安装插件。不要在本插件目录直接运行 `pnpm dsh`，因为本仓库不会额外捆绑完整 Harness CLI：

```bash
cd ~/deepseek-harness
pnpm dsh plugin --profile web add -w github:Mshir0/context-graph-deepseek-harness
pnpm dsh --profile web --dump-config
pnpm dsh web
```

如果没有本地 Harness checkout，也可以用固定版本的临时 CLI 安装和启动：

```bash
pnpm dlx @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add -w github:Mshir0/context-graph-deepseek-harness
pnpm dlx @deepseek-ai/dsh@0.1.0-rc.6 --profile web --dump-config
pnpm dlx @deepseek-ai/dsh@0.1.0-rc.6 web
```

从 GitHub 克隆本仓库后，也可以用随插件发布的安装脚本自动选择全局 DSH、指定的 Harness checkout 或固定版本临时 CLI：

```bash
git clone https://github.com/Mshir0/context-graph-deepseek-harness.git
cd context-graph-deepseek-harness
DSH_HARNESS_DIR=~/deepseek-harness ./scripts/install-linux.sh
```

`--dump-config` 中应出现 `context-graph`。如果你安装的是全局 CLI，请把 `pnpm dsh` 整体替换为 `dsh`；`pnpm dlx ...` 是另一种完整调用方式，不能只去掉其中的 `pnpm`。`web` 是 DSH 的独立应用命令，它固定使用 `web` profile，因此不能写成 `pnpm dsh --profile web web`。插件没有 `prepare` 构建脚本，从 GitHub 安装不需要放开 pnpm 的安装期代码执行。

## 在 DSH 中使用

插件注册以下模型可调用工具：

- `context_graph_scan`：分析当前 Session workspace，初始化 `.context/` 并返回关系漂移建议。
- `context_graph_get`：读取 Context Graph。
- `context_graph_save`：保存用户确认后的完整 Graph JSON。
- `context_graph_add_node` / `context_graph_add_edge`：保存单个已确认的 Context Node 或手工关系。
- `context_extract`：从单条用户或 AI 消息提取可追溯的 Task、Requirement、Constraint、Decision 或 Issue Proposal；仅在 `apply=true` 时保存。
- `context_detect_conflicts`：检查尚未通过 `supersedes` 解决的潜在结构化上下文冲突。
- `context_select`：为当前 DSH Session 指定目标模块以及临时加入/排除项。
- `context_session_config`：仅为当前 DSH Session 设置自动注入开关、单轮预算、上下文复用和临时包含/排除；不改写图谱或代码。
- `context_compile`：预览 token 预算下最终会注入的上下文。
- `context_request`：按 Functional、实现模块或符号请求受硬预算限制的接口、实现、测试或文档上下文。
- `context_audit`：读取当前 Session 最近一次 Context Firewall 决策、五段 Token 审计、验证结果和 Session Surface 放置动作。
- `context_git_summary`：读取当前 workspace 的相关 Git 状态和历史。
- `functional_infer`：从已分析的实现模块生成待确认的功能节点、功能关系和多对多实现映射；仅在 `apply=true` 时保存。
- `functional_map_implementation`：手动保存功能节点到实现节点的映射，不修改源码。
- `functional_merge` / `functional_split`：调整功能节点粒度，不修改源码或文件路径。
- `dependency_discover_modules`：只读发现 Python 模块、符号和可选变更文件的增量事实。
- `dependency_analyze_module` / `dependency_analyze_dependencies`：读取模块关系、接口与证据。
- `dependency_find_callers` / `dependency_find_callees` / `dependency_find_related_modules`：查询调用与直接模块关系。
- `dependency_extract_interface`：读取函数和类的输入、输出与定义证据。
- `dependency_propose_context_edges` / `dependency_check_consistency`：生成非绑定 Edge 建议，并检查缺失、陈旧和被用户保护的关系；不会写入 Graph。
- `dependency_validate_relationship` / `dependency_detect_changes`：验证单条 Edge，或比较保留的前一次事实 JSON 与当前代码关系。

当 `autoInject` 开启时，插件会在每次 `agent/pre-step`：

1. 从 `agent.session.header.cwd` 获取当前工程，不接受模型任意选择宿主路径。
2. 根据当前用户任务和 Session 的 `context_select` 状态确定目标模块。
3. 编译目标源码、结构化记忆、最小依赖接口和相关 Git 历史。
4. 生成包含 Raw / Candidate / Selected / Excluded / Final Token 统计的 Context Manifest，并执行发送前验证。
5. 在 `firewallMode: enforce` 下通过 DSH Session Surface 将历史表面替换为当前精选快照；已有历史无法可靠替换时阻止本轮，而不是静默追加。
6. 在官方最终 `llm/stream` 边界校验完整消息列表与快照指纹，并限制 `system + messages + tools + output reserve` 的保守 Token 估值；超出 `requestTokenBudget` 时阻止发送。
7. 使用 `context_audit` 保留允许或阻止原因、验证结果、完整 Payload 指纹和 Surface 动作；相同任务和上下文仍会复用去重。

如果目标模块无法可靠推断，插件不会猜测或加载全工程；Agent 可调用 `context_select` 明确目标。

在 `firewallMode: enforce` 下关闭某个会话的 `autoInject`，只会关闭图谱内容注入，不会恢复旧历史：插件仍用一个不含项目图谱内容的空快照替换 Session Surface，并继续执行最终请求审计。若希望完全停用边界控制，需要在插件配置中显式使用 `firewallMode: off`。

## Modular Context Graph

代码模块只是统一 Context Node 的一种。`graph.json` 同时支持 `requirement`、`task`、`constraint`、`decision`、`interface`、`documentation`、`conversation`、`artifact`、`test`、`issue`、`note` 和 `project_rule`。每个节点可以保存内容、来源、优先级、状态、时间和扩展 metadata。

原始 Conversation/Message 节点标记为 Raw Layer，仅通过 `derived_from` 和 `contains` 提供来源追溯，不会默认进入模型上下文。`context_compile` 可从 Task、Requirement、Issue、Test 或 CodeModule 等任意 `entry` 开始遍历，并在预览中报告包含节点、排除节点、关系原因和估算 Tokens。

`skills/context-extraction/SKILL.md` 规定保守提取、确认后保存、来源追溯、`supersedes` 和冲突检查流程。无法确定模块目标时不会创建猜测关系。

随插件发布的 Skill 按职责拆分为 `module-discovery`、`dependency-analysis`、`interface-contract`、`context-extraction`、`context-routing`、`context-maintenance`、`context-compiler` 和 `context-firewall`，共享同一 Graph 与工具接口。

## Context Manifest 与 Firewall

`context_compile` 返回兼容的顶层摘要和正式 `manifest`。Manifest 记录任务、目标、预算、Policy、Graph Revision、生成时间、五段 Token 统计以及每个条目的 `policyClass`、`score`、`source`、`reason`、`tokens` 和内容哈希。`validation` 会报告预算溢出、Force Exclude 冲突、重复内容、未经授权的 Raw Conversation 等阻断原因。Preview 阶段尚未组装 Harness 的 system 和工具 schema，因此其中的 Final 显示为待审计，而不会伪装成 Selected。

`tokenBudget` 是 Selected Context Graph 条目的硬预算；`requestTokenBudget` 是最终模型调用的总预算，包含经安全系数放大的输入估值与输出预留。真正的请求边界由 Context Firewall 在 DSH Session Surface 和 `llm/stream` 上完成，并由 `context_audit` 给出 `prepend`、`surface-replace` 或 `blocked` 动作。只有验证通过、最终估值未超限且审计显示成功放置时，才能认为未选择的历史没有进入最终模型请求。

Token 统计是跨模型可用的保守字符估值，不等同于供应商账单中的精确 tokenizer 数字。默认 `tokenSafetyRatio: 1.15` 留出协议包装误差；若模型请求中的 `maxTokens` 高于 `outputReserveTokens`，防火墙会采用更高的实际输出上限。模型上下文窗口较小时，应相应降低 `requestTokenBudget`。

## Semantic Functional Graph

默认图谱是语义功能图：它回答工程“做什么”，显示功能节点（例如 `ASR`、`Video Recording`）、结构化上下文和 `provides`、`depends_on`、`affects` 等语义关系。文件、类、函数、import 与 call 属于实现图，默认不会污染该视图。

功能节点可包含描述、输入输出、提供和消费的能力，并通过 `mappings` 与一个或多个实现节点建立多对多映射。用户在功能节点检查器中点击“查看实现”后，才会展开该功能对应的源码实现。重命名、合并或拆分功能节点只改图谱元数据，绝不会重命名或改写代码文件。

Context Compiler 从任务或功能节点开始，先遍历需求、约束、决策、接口和功能关系，再按任务词匹配功能映射中的少量实现文件。它不会从功能节点递归展开 import 或 call，因此无关模块不会因底层依赖而进入上下文。

## Dependency & Interface Skill

`skills/dependency-interface/SKILL.md` 随插件发布。它将 Python AST 分析作为独立的工程依赖事实发现层：输出模块、符号级关系、接口 Contract、代码证据及置信度；不保存 Context Graph、不修改业务代码，也不决定模型最终上下文。Context Graph 的更新仍必须经 `context_graph_save` 显式确认，`FORCE_INCLUDE` 和 `FORCE_EXCLUDE` 永远优先于自动分析。

依赖分析支持工作区外层包目录与 Python import 包根不同的布局（例如 `starlette/starlette/*.py`），也支持包内相对导入。关系目标保留扫描得到的规范模块 ID，并通过唯一包根别名解析源码 import；存在多个候选时不会猜测或写入关系。用户确认的 `MANUAL` 边会被一致性检查保留，不会作为陈旧自动关系建议删除。

## Harness 对话视图

打开 `http://127.0.0.1:3080/` 后，Context Graph 作为 DSH client 插件注册到官方 `conversation.view` 槽，与“对话”和“轨迹”并列。不存在 `/context-graph/` 独立页面，也不占用右侧详情栏。

图谱视图支持：

- 中文界面以及跟随 DSH 的浅色/深色显示。
- 节点拖动、画布平移、滚轮缩放、适合画布和自动排布。
- 创建和编辑不同类型的 Context Node，并按标题、内容或节点类型搜索筛选。
- 删除扫描生成的代码/实现节点时会写入 `overrides.deleted` 墓碑，后续扫描不会将它重新加入；如需恢复，可从 Graph JSON 的该数组中移除节点 ID。
- 从节点右端口拖到另一节点左端口，手动创建连接。
- 编辑关系类型、scope 和 `AUTO / MANUAL / FORCE_INCLUDE / FORCE_EXCLUDE`。
- 从当前选择的任意 Context Entry 打开 Context Preview。
- 对话输入区的“上下文”弹层可按当前对话关闭自动注入、选择 2k-16k 单轮预算、限制相关实现文件和语义关联层数，并控制是否复用未变化上下文。
- 在“上下文”弹层中填写任务、选择任务类型后，可用“创建任务并发送”直接创建持久 `Task` 节点并发送给 DSH；它会优先使用手动选择的功能目标，未选择时自动识别目标，并将新任务设为当前对话的上下文入口。
- “添加到输入框”只整理任务文本，不创建图谱节点；普通 DSH 消息同样保持普通对话，不会自动落入图谱。
- Context Preview 显示正式 Manifest 条目的 Class、Score、Source、Reason 和 Tokens，以及 Raw / Candidate / Selected / Excluded / Final 审计和验证错误；可对已包含项强制排除、对已排除项强制包含，且只影响当前对话。
- 语义、实现、当前上下文三种视图；语义视图默认隐藏实现细节。实现视图支持文件、类、函数、符号层级筛选，并从映射文件逐级展开子实现。
- 扫描实现后使用“推断功能模块”预览功能归并，再确认加入图谱。
- 图谱标题栏的“+”会先打开节点类型菜单，可明确选择“功能、任务、需求、约束、决策、问题或备注”，再创建节点；不再随当前视图隐式创建不同类型。
- `Ctrl/⌘ + S` 保存、`Delete` 删除、`F` 适合画布、`A` 自动排布、`Esc` 取消。
Host 端仅挂载同源 `/context-graph/api/*` 数据接口，并校验请求路径必须属于 `ctx.workspaceRegistry` 中已注册的 workspace。

## Bundle 配置

默认配置位于 `cordis.patch.yml`：

```yaml
- insert:
    - id: context-graph
      name: dsh-context-graph
      config:
        tokenBudget: 6000
        requestTokenBudget: 64000
        outputReserveTokens: 6000
        tokenSafetyRatio: 1.15
        allowedInstructionPlugins: []
        autoScan: true
        autoInject: true
        firewallMode: enforce
        webUi: true
```

`firewallMode: enforce` 依赖 DSH `0.1.0-rc.6` 的 Runtime Context suppression API；缺少该能力时插件会拒绝启用 enforce，而不会假装已裁剪最终请求。`firewallMode: audit` 不调用 Runtime Context suppression，也不替换 Session Surface；它只把标记为 audit 的编译快照放入当前 step，并报告最终请求中仍存在的历史或动态上下文。默认不接受其他插件注入的 instruction 消息；确有可信静态插件需要时，可通过 `allowedInstructionPlugins` 显式列出其插件 ID。

用户可在自己的 profile 或 `$DSH_HOME/cordis.patch.yml` 中按 `id: context-graph` 覆盖整行配置。

## 工程记忆

首次扫描在当前工程创建：

```text
.context/
├── project.md
├── graph.json
├── cache/
│   └── implementation-facts.json
└── modules/<module>/
    ├── context.md
    ├── interface.md
    ├── state.md
    └── decisions.md
```

`project.md`、`graph.json` 和人工维护的模块记忆是工程级长期知识，建议提交到目标工程的 Git，而不是依赖聊天历史。`cache/implementation-facts.json` 是可重建的分析缓存，通常应加入目标工程的 `.gitignore`：文件未变化时直接复用事实，文件集合稳定时只重新分析内容变化的文件；新增或删除源码文件时会保守地重新分析全工程，以避免包根和导入别名失真。

## 验证

```bash
node --test
pnpm check
python3 -m py_compile src/analyze_python.py src/dependency_skill.py
```

项目当前以 DeepSeek Harness 开发预览期的 `0.1.x` API 为目标。DSH 官方明确提示预览期可能有破坏性变更，升级 Harness 后应重新运行测试并检查 `--dump-config`。
