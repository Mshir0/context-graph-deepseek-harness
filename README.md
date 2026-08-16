# Context Graph + DeepSeek Harness

一个面向 DeepSeek Harness、Codex 等 AI Coding Agent 的工程上下文管理插件。它把真实代码依赖和 AI 上下文策略分开，使用可视化图编辑器维护模块关系，并按任务和 token 预算编译最小相关上下文。

## 能力

- Python 标准库 AST 代码分析：imports、调用、类、继承、symbol 定义和模块依赖。
- 独立的 `Code Graph` 与 `Context Graph`，支持 `dependency`、`interface`、`data`、`optional`、`force_include`、`force_exclude` 等关系。
- `.context/` 长期记忆：`project.md` 和每个模块的 `context.md`、`interface.md`、`state.md`、`decisions.md`。
- 优先级上下文编译器：用户任务和目标模块优先，依次裁剪可选依赖及 Git 历史，生成 Context Preview。
- ComfyUI 风格 SVG 图编辑器：拖拽、连线、关系类型、范围、三态覆盖、缩放、自动布局、扫描建议和保存。
- MCP 工具：扫描、读取/保存图、编译上下文、Git 摘要。DeepSeek 适配器使用 OpenAI 兼容流式接口。
- 零 npm 依赖；Node.js 20+ 和 Python 3 标准库即可运行。

## Linux 使用

```sh
git clone https://github.com/Mshir0/context-graph-deepseek-harness.git
cd context-graph-deepseek-harness
./scripts/install-linux.sh
node src/server.js
```

浏览器打开 <http://127.0.0.1:4317>，将 Project 指向要分析的工程，点击 `Scan code`。首次扫描会创建 `.context/`；该目录建议加入你的工程 Git，因为它是长期工程知识而不是聊天记录。

也可以把指定工程设为默认路径：

```sh
CONTEXT_GRAPH_PROJECT=/path/to/project node src/server.js
```

## DeepSeek

服务端只在用户调用 `/api/chat` 时读取环境变量，不会把密钥写入工程文件：

```sh
export DEEPSEEK_API_KEY="sk-..."
export DEEPSEEK_MODEL="deepseek-chat"       # optional
export DEEPSEEK_BASE_URL="https://api.deepseek.com" # optional
```

## Codex / MCP

插件清单在 `.codex-plugin/plugin.json`，MCP 配置在 `.mcp.json`。在 Codex 中安装本地插件后，MCP 工具会提供 `context_graph_scan`、`context_graph_get`、`context_graph_save`、`context_compile` 和 `context_git_summary`。`skills/context-graph/SKILL.md` 包含 Agent 使用规则。

## 验证

```sh
npm test
npm run check
```

项目的 JSON schema 位于 `schemas/context-graph.schema.json`。关系扫描只提出建议，不会自动删除用户手工关系；`FORCE_EXCLUDE` 始终优先于自动选择。
