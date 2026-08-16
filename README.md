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
source-attributed plugin message
      ↓
DSH model adapter (DeepSeek / other configured provider)
```

## 安装到 DeepSeek Harness

要求：

- DeepSeek Harness `0.1.0-rc.5` 或更新的 `0.1.x` 版本
- Node.js `^22.19.0` 或 `>=24`
- Python 3（完整 Python AST 分析；没有 Python 时会使用轻量回退分析）

从 GitHub 安装进 DSH profile：

```bash
git clone https://github.com/Mshir0/context-graph-deepseek-harness.git
cd context-graph-deepseek-harness
pnpm dsh plugin --profile web add -w .
```

也可以直接从 GitHub 安装：

```bash
pnpm dsh plugin --profile web add -w github:Mshir0/context-graph-deepseek-harness
```

确认 bundle 已进入组合配置并启动 Harness：

```bash
pnpm dsh --profile web --dump-config
pnpm dsh web
```

`--dump-config` 中应出现 `context-graph`。如果你安装的是全局 `dsh`，可去掉命令前面的 `pnpm`。`web` 是 DSH 的独立应用命令，它固定使用 `web` profile，因此不能写成 `pnpm dsh --profile web web`。插件没有 `prepare` 构建脚本，从 GitHub 安装不需要放开 pnpm 的安装期代码执行。

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
4. 以 `source.kind = plugin` 的 DSH 用户消息注入当前 step。
5. 对相同任务去重；当连续任务的目标和已编译上下文完全未变化时，复用先前上下文而不重复注入。

如果目标模块无法可靠推断，插件不会猜测或加载全工程；Agent 可调用 `context_select` 明确目标。

## Modular Context Graph

代码模块只是统一 Context Node 的一种。`graph.json` 同时支持 `requirement`、`task`、`constraint`、`decision`、`interface`、`documentation`、`conversation`、`artifact`、`test`、`issue`、`note` 和 `project_rule`。每个节点可以保存内容、来源、优先级、状态、时间和扩展 metadata。

原始 Conversation/Message 节点标记为 Raw Layer，仅通过 `derived_from` 和 `contains` 提供来源追溯，不会默认进入模型上下文。`context_compile` 可从 Task、Requirement、Issue、Test 或 CodeModule 等任意 `entry` 开始遍历，并在预览中报告包含节点、排除节点、关系原因和估算 Tokens。

`skills/context-extraction/SKILL.md` 规定保守提取、确认后保存、来源追溯、`supersedes` 和冲突检查流程。无法确定模块目标时不会创建猜测关系。

随插件发布的 Skill 按职责拆分为 `module-discovery`、`dependency-analysis`、`interface-contract`、`context-extraction`、`context-routing`、`context-maintenance` 和 `context-compiler`，共享同一 Graph 与工具接口。

## Semantic Functional Graph

默认图谱是语义功能图：它回答工程“做什么”，显示功能节点（例如 `ASR`、`Video Recording`）、结构化上下文和 `provides`、`depends_on`、`affects` 等语义关系。文件、类、函数、import 与 call 属于实现图，默认不会污染该视图。

功能节点可包含描述、输入输出、提供和消费的能力，并通过 `mappings` 与一个或多个实现节点建立多对多映射。用户在功能节点检查器中点击“查看实现”后，才会展开该功能对应的源码实现。重命名、合并或拆分功能节点只改图谱元数据，绝不会重命名或改写代码文件。

Context Compiler 从任务或功能节点开始，先遍历需求、约束、决策、接口和功能关系，再按任务词匹配功能映射中的少量实现文件。它不会从功能节点递归展开 import 或 call，因此无关模块不会因底层依赖而进入上下文。

## Dependency & Interface Skill

`skills/dependency-interface/SKILL.md` 随插件发布。它将 Python AST 分析作为独立的工程依赖事实发现层：输出模块、符号级关系、接口 Contract、代码证据及置信度；不保存 Context Graph、不修改业务代码，也不决定模型最终上下文。Context Graph 的更新仍必须经 `context_graph_save` 显式确认，`FORCE_INCLUDE` 和 `FORCE_EXCLUDE` 永远优先于自动分析。

## Harness 对话视图

打开 `http://127.0.0.1:3080/` 后，Context Graph 作为 DSH client 插件注册到官方 `conversation.view` 槽，与“对话”和“轨迹”并列。不存在 `/context-graph/` 独立页面，也不占用右侧详情栏。

图谱视图支持：

- 中文界面以及跟随 DSH 的浅色/深色显示。
- 节点拖动、画布平移、滚轮缩放、适合画布和自动排布。
- 创建和编辑不同类型的 Context Node，并按标题、内容或节点类型搜索筛选。
- 从节点右端口拖到另一节点左端口，手动创建连接。
- 编辑关系类型、scope 和 `AUTO / MANUAL / FORCE_INCLUDE / FORCE_EXCLUDE`。
- 从当前选择的任意 Context Entry 打开 Context Preview。
- “上下文”弹层可按当前对话关闭自动注入、选择 2k-16k 单轮预算、限制相关实现文件和语义关联层数，并控制是否复用未变化上下文。
- Context Preview 显示已用预算、每项 Token 与原因；可将单项仅排除出当前对话，不改变永久图谱。
- 语义、实现、当前上下文三种视图；语义视图默认隐藏实现细节。
- 扫描实现后使用“推断功能模块”预览功能归并，再确认加入图谱。
- `Ctrl/⌘ + S` 保存、`Delete` 删除、`F` 适合画布、`A` 自动排布、`Esc` 取消。
对话输入区的“上下文”命令可把任务类型、内容和当前目标添加到 DSH 原生输入框。Host 端仅挂载同源 `/context-graph/api/*` 数据接口，并校验请求路径必须属于 `ctx.workspaceRegistry` 中已注册的 workspace。

## Bundle 配置

默认配置位于 `cordis.patch.yml`：

```yaml
- insert:
    - id: context-graph
      name: dsh-context-graph
      config:
        tokenBudget: 6000
        autoScan: true
        autoInject: true
        webUi: true
```

用户可在自己的 profile 或 `$DSH_HOME/cordis.patch.yml` 中按 `id: context-graph` 覆盖整行配置。

## 工程记忆

首次扫描在当前工程创建：

```text
.context/
├── project.md
├── graph.json
└── modules/<module>/
    ├── context.md
    ├── interface.md
    ├── state.md
    └── decisions.md
```

这些文件是工程级长期记忆，建议提交到目标工程的 Git，而不是依赖聊天历史。

## 验证

```bash
node --test
pnpm check
```

项目当前以 DeepSeek Harness 开发预览期的 `0.1.x` API 为目标。DSH 官方明确提示预览期可能有破坏性变更，升级 Harness 后应重新运行测试并检查 `--dump-config`。
