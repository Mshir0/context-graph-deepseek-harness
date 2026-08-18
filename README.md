# Context Graph for DeepSeek Harness

[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-DSH-111827)](https://github.com/deepseek-ai/deepseek-harness)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-2563eb)](https://github.com/topics/dsh-plugin)
[![C/C++](https://img.shields.io/badge/parser-C%20%2F%20C%2B%2B-f59e0b)](#cc-解析)
[![License](https://img.shields.io/badge/license-MIT-16a34a)](LICENSE)

面向 AI Coding Agent 的工程上下文管理插件。它直接加载到 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的对话界面，在对话与轨迹旁提供 Context Graph 视图，并在模型请求前编译、审计和注入与当前任务相关的工程上下文。

它不是独立软件，不启动额外网页，也不替换 Harness 的模型客户端。

## 解决什么问题

AI Coding Agent 通常同时面对三类信息：当前任务、项目记忆和源码依赖。全部发送会浪费上下文预算，只发送当前一句话又容易遗漏接口约束。

Context Graph 把这些信息拆成可追溯的节点和关系：

```text
用户任务
   ↓
语义功能 / 需求 / 约束 / 决策
   ↓
实现文件 / 类 / 函数 / 接口
   ↓
Context Compiler
   ↓
预算受控的模型上下文
```

## 特性

### 语义功能图

- 用功能、任务、需求、约束、决策、问题和备注描述“系统做什么”。
- 功能节点可以映射到多个实现文件，支持合并、拆分和手动调整。
- 语义视图默认隐藏 import、call 等实现细节，避免功能图被代码关系污染。

### 实现与依赖图

- 扫描 Python、C 和 C++ 模块、符号、调用、继承、接口和项目内依赖。
- 支持增量扫描、变更检测、调用方/被调用方查询和接口提取。
- 自动关系只在源码证据足够明确时生成；不猜测宏展开、重载歧义或外部符号。

### C/C++ 解析

支持以下扩展名，无需安装 clang：

```text
.c  .cc  .cpp  .cxx  .h  .hh  .hpp  .hxx
```

可提取：

- 项目内 `#include` 关系
- 类和结构体
- 函数定义与声明
- 唯一可确认的函数调用
- 继承关系

源文件和头文件使用独立模块 ID，避免同名文件冲突。无法唯一确认的关系会保留为未知，不会自动写入错误依赖。

### PDF 章节按需阅读

- `document_scan` 只读取 PDF 元数据和原生目录，先建立文档、章节与层级关系。
- `document_find_sections` 根据当前任务匹配目录标题，不预先加载整本正文。
- `document_extract_sections` 只提取选中章节的页码范围，并在内容中保留文件与页码引用。
- `document_extract_layout` 从选中章节识别代码块与表格，代码保存为围栏块，表格同时保存 Markdown 和 JSON。
- `apply=true` 时，提取结果保存到对应 `documentation` 节点，之后可由 Context Compiler 按预算选择。

布局结果会保存页码和 `bbox`，并作为章节的 `contains` 子节点加入图谱。当前不执行 OCR，也不会为没有原生书签的 PDF 猜测目录；此类文件会返回 `outlineAvailable: false`。

### 上下文编译与防火墙

- 从任务或功能目标开始，只选择相关的结构化上下文和少量实现文件。
- 支持单轮预算、相关实现文件数量、语义关联层数、临时包含/排除和上下文复用。
- 在 `agent/pre-step` 编译 Context Snapshot，在最终 `llm/stream` 请求边界执行消息、快照、工具和 token 审计。
- `FORCE_INCLUDE`、`FORCE_EXCLUDE` 和用户确认的 `MANUAL` 关系优先于自动分析。
- 普通对话无法推断目标时使用空的 `context.none` 快照，不会因为图谱暂时不可用吞掉用户输入。

### 原生 Harness 界面

- Context Graph 作为 Harness 对话区域的原生视图标签。
- 支持中文、明暗主题、节点拖动、画布平移、缩放、自动排布和属性编辑。
- 右下角输入框可直接发送普通对话；“上下文”按钮用于创建持久任务、选择任务类型和调整本会话注入策略。
- Context Preview 显示包含项、排除项、来源、原因、token 统计和最终审计结果。

## 环境要求

- DeepSeek Harness `0.1.0-rc.6` 或更新的 `0.1.x`
- Node.js `^22.19.0` 或 `>=24`
- Python 3（用于 Python AST 和 C/C++ 依赖事实提取；缺失时使用轻量回退扫描）
- [PyMuPDF](https://pymupdf.readthedocs.io/) 或 `pypdf`（PDF 目录和章节文本提取；优先使用 PyMuPDF）

启用 PDF 支持：

```bash
cd ~/context-graph-deepseek-harness
python3 -m venv .venv-pdf
.venv-pdf/bin/python -m pip install pymupdf pypdf pdfplumber
```

插件会依次查找显式配置、当前虚拟环境、项目 `.venv-pdf` / `.venv`、插件 `.venv-pdf`、用户目录下的插件源码环境和系统 Python。通常无需为 Harness 单独配置环境变量；如需强制指定，仍可设置 `CONTEXT_GRAPH_PDF_PYTHON`。

## 安装

### 本地源码安装（推荐用于验证修复）

插件源码必须位于 WSL 文件系统中。可以将当前源码复制到 WSL，或在 WSL 中克隆后作为本地依赖使用：

```bash
cd ~/deepseek-harness
git clone https://github.com/Mshir0/context-graph-deepseek-harness.git ~/context-graph-deepseek-harness
pnpm dsh plugin --profile web add -w /home/mashiro/context-graph-deepseek-harness
pnpm dsh --profile web --dump-config
pnpm dsh web
```

修改 `/home/mashiro/context-graph-deepseek-harness` 中的源码后，重新执行 `add -w` 并重启 Harness。这样加载的是本地源码，不会使用旧的 GitHub 包缓存。

### 从 GitHub 安装

```bash
cd ~/deepseek-harness
npx -y @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web add -w github:Mshir0/context-graph-deepseek-harness
npx -y @deepseek-ai/dsh@0.1.0-rc.6 --profile web --dump-config
npx -y @deepseek-ai/dsh@0.1.0-rc.6 web
```

`--dump-config` 中应出现 `context-graph` 和 `dsh-context-graph`。首次安装或升级后需要重启 Harness；浏览器仍显示旧界面时执行 `Ctrl+Shift+R`。

### 从源码运行 Harness

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build

git clone https://github.com/Mshir0/context-graph-deepseek-harness.git ~/context-graph-deepseek-harness
pnpm dsh plugin --profile web add -w ~/context-graph-deepseek-harness
pnpm dsh web
```

修改插件源码后重新执行 `pnpm dsh plugin ... add -w`，然后重启 `pnpm dsh web`。

### 其他本地开发路径

在 Harness 源码目录执行：

```bash
pnpm dsh plugin --profile web add -w /path/to/context-graph-deepseek-harness
pnpm dsh web
```

插件没有独立 Web 服务。Host 代码在 Harness 启动时加载，Client bundle 由插件 manifest 注册到 DSH 的 client loader。

## 在对话中使用

1. 打开 Harness 的 `http://127.0.0.1:3080/`。
2. 进入一个带工程工作区的会话。
3. 直接在右下角输入框发送普通消息，插件会尝试注入当前任务相关上下文。
4. 需要持久任务时，打开“上下文”，填写任务内容并选择任务类型；“添加到输入框”只整理文本，“创建任务并发送”会保存 `Task` 节点后发送。
5. 在“上下文图谱”视图中扫描代码、确认功能推断、查看实现映射或打开 Context Preview。

常用快捷键：

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl/⌘ + S` | 保存图谱 |
| `Delete` | 删除选中节点或关系 |
| `F` | 适合画布 |
| `A` | 自动排布 |
| `Esc` | 取消当前操作 |

## 工具与 Skills

插件向 DSH 注册以下主要工具：

| 工具 | 用途 |
| --- | --- |
| `context_graph_scan` | 扫描工程并同步代码模块事实 |
| `functional_infer` | 生成待确认的功能节点和实现映射 |
| `context_compile` | 预览预算下最终上下文 |
| `context_select` | 设置当前会话目标、包含和排除项 |
| `context_session_config` | 设置自动注入、复用和单轮预算 |
| `context_audit` | 查看防火墙最终决策和 token 审计 |
| `dependency_discover_modules` | 发现 Python/C/C++ 模块、符号和依赖 |
| `dependency_analyze_module` | 查看模块关系、接口和证据 |
| `dependency_find_callers` / `dependency_find_callees` | 查询调用方和被调用方 |
| `dependency_extract_interface` | 提取函数/类的接口契约 |
| `dependency_check_consistency` | 按文件或模块检查一致性，默认最多返回 50 条明细 |
| `context_extract` | 从对话提取可确认的结构化记忆 |
| `document_scan` | 读取 PDF 原生目录并建立章节图谱，默认返回前 50 项 |
| `document_find_sections` | 按任务匹配目录章节，不读取正文 |
| `document_extract_sections` | 按页提取选中章节并可持久化到图谱 |
| `document_extract_layout` | 提取章节内代码块和 Markdown+JSON 表格 |

随插件发布的 Skills 按职责拆分为 `module-discovery`、`dependency-analysis`、`interface-contract`、`document-analysis`、`context-extraction`、`context-routing`、`context-maintenance`、`context-compiler` 和 `context-firewall`。

## 配置

默认 bundle 配置位于 `cordis.patch.yml`：

```yaml
config:
  tokenBudget: 6000
  requestTokenBudget: 512000
  outputReserveTokens: 256000
  tokenSafetyRatio: 1.15
  autoScan: true
  autoInject: true
  firewallMode: enforce
  webUi: true
```

`tokenBudget` 控制选中的 Context Graph 条目；`requestTokenBudget` 控制最终模型请求；`outputReserveTokens` 为模型输出预留空间。它们不是供应商账单中的精确 tokenizer 数字，而是跨模型可用的保守估值。

如果关闭 `autoInject`，插件仍会在 `firewallMode: enforce` 下使用不含项目图谱的空快照替换会话表面。只有显式设置 `firewallMode: off` 才会完全停用边界控制。

## 卸载

先停止 Harness，再执行：

```bash
npx -y @deepseek-ai/dsh@0.1.0-rc.6 plugin --profile web remove dsh-context-graph
```

如果提示 `ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS`，说明依赖位于 Harness workspace 或 profile 的其他层。检查：

```bash
grep -RniE 'dsh-context-graph|context-graph' \
  ~/deepseek-harness/package.json \
  ~/.dsh/profiles/web/package.json \
  ~/.dsh/profiles/web/cordis.patch.yml 2>/dev/null
```

从实际包含依赖的目录执行 `pnpm remove dsh-context-graph`；若 `cordis.patch.yml` 仍有 `id: context-graph` 的插件块，删除该块后重启 Harness。项目 `.context/` 目录是图谱数据，不负责加载插件按钮。

## 开发与验证

```bash
pnpm install
pnpm run check
node --test test/context-firewall.test.js
node --test test/c-family.test.js
```

完整测试：

```bash
pnpm test
```

完整 DSH 生命周期测试需要 Harness 依赖和官方 runtime；如果本地 pnpm 需要清理 `node_modules`，请在交互式终端执行，不要在无 TTY 的 CI shell 中强制删除依赖目录。

## 设计边界

- Context Graph 不会自动修改业务源码。
- 扫描结果不会未经确认直接创建语义功能关系；`functional_infer` 只生成待确认提案。
- 原始对话节点默认保留来源追溯，但不会自动注入模型上下文。
- 代码调用关系属于实现图，不会直接冒充功能关系。
- Context Firewall 无法安全替换已有历史时会阻止请求，而不是静默把未选择的历史发送给模型。

## 参与贡献

欢迎通过 [Issue](https://github.com/Mshir0/context-graph-deepseek-harness/issues) 和 Pull Request 反馈问题或提交改进。涉及 Host 生命周期、防火墙、依赖扫描或 UI 的改动，请同时补充相应回归测试。

## 许可证

[MIT](LICENSE)
