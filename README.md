# Context Graph for DeepSeek Harness

这是一个由 **DeepSeek Harness (`dsh`) 直接加载的 Cordis 插件**，不是独立软件，也不会自行启动模型客户端或 Web 服务。

插件使用 DSH 的 Agent 生命周期、工具注册表、Session workspace 和共享 Web Server：

```text
DSH user message
      ↓
agent/pre-step
      ↓
Code Graph + Context Graph + manual overrides
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
dsh plugin --profile default add -w .
```

也可以直接从 GitHub 安装：

```bash
dsh plugin --profile default add -w github:Mshir0/context-graph-deepseek-harness
```

确认 bundle 已进入组合配置并启动 Harness：

```bash
dsh --profile default --dump-config
dsh --profile default web
```

`--dump-config` 中应出现 `context-graph`。插件没有 `prepare` 构建脚本，因此从 GitHub 安装不需要放开 pnpm 的安装期代码执行。

## 在 DSH 中使用

插件注册以下模型可调用工具：

- `context_graph_scan`：分析当前 Session workspace，初始化 `.context/` 并返回关系漂移建议。
- `context_graph_get`：读取 Context Graph。
- `context_graph_save`：保存用户确认后的完整 Graph JSON。
- `context_select`：为当前 DSH Session 指定目标模块以及强制加入/排除项。
- `context_compile`：预览 token 预算下最终会注入的上下文。
- `context_git_summary`：读取当前 workspace 的相关 Git 状态和历史。
- `context_graph_ui`：返回 Harness 内图编辑器路径。

当 `autoInject` 开启时，插件会在每次 `agent/pre-step`：

1. 从 `agent.session.header.cwd` 获取当前工程，不接受模型任意选择宿主路径。
2. 根据当前用户任务和 Session 的 `context_select` 状态确定目标模块。
3. 编译目标源码、结构化记忆、最小依赖接口和相关 Git 历史。
4. 以 `source.kind = plugin` 的 DSH 用户消息注入当前 step。
5. 对相同任务和相同内容去重，避免每个 step 重复膨胀上下文。

如果目标模块无法可靠推断，插件不会猜测或加载全工程；Agent 可调用 `context_select` 明确目标。

## Harness 内图编辑器

Web profile 中，插件通过 DSH 的 `ctx.webServer` 挂载：

```text
/context-graph/
```

它与 DSH 共用进程和端口，不启动独立服务。图编辑 API 只允许 `ctx.workspaceRegistry` 已注册的 workspace。界面支持节点拖拽、关系与 scope 编辑、AUTO / FORCE_INCLUDE / FORCE_EXCLUDE、缩放、自动布局、关系漂移建议和 Context Preview。

## Bundle 配置

默认配置位于 `cordis.patch.yml`：

```yaml
- insert:
    - id: context-graph
      name: dsh-context-graph
      config:
        tokenBudget: 16000
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
node --check src/dsh-plugin.js
node --check src/dsh-routes.js
```

项目当前以 DeepSeek Harness 开发预览期的 `0.1.x` API 为目标。DSH 官方明确提示预览期可能有破坏性变更，升级 Harness 后应重新运行测试并检查 `--dump-config`。
