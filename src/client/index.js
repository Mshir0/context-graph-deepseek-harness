(function registerContextGraphClient() {
  window.__ModuleLoader__.load({
    id: 'dsh-context-graph',
    factory: require => {
const { createElement: h, useCallback, useEffect, useMemo, useRef, useState } = require('react');
const styles = String.raw`
.cg-root{--cg-line:#e5e7eb;--cg-muted:#6b7280;--cg-text:#171717;--cg-bg:#fff;--cg-soft:#f7f7f8;--cg-accent:#2563eb;display:grid;grid-template-rows:48px minmax(0,1fr) auto;height:100%;min-width:0;background:var(--cg-bg);color:var(--cg-text);font:13px/1.4 Inter,ui-sans-serif,system-ui,sans-serif}
.cg-root *{box-sizing:border-box;letter-spacing:0}.cg-header{display:flex;align-items:center;gap:6px;padding:0 10px;border-bottom:1px solid var(--cg-line);min-width:0}.cg-title{font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-right:auto}.cg-search{width:150px;min-width:70px;border:1px solid var(--cg-line);border-radius:5px;background:var(--cg-bg);color:var(--cg-text);font:inherit;padding:5px 7px}.cg-filter{max-width:120px;border:1px solid var(--cg-line);border-radius:5px;background:var(--cg-bg);color:var(--cg-text);font:inherit;padding:5px}.cg-icon{width:30px;height:30px;display:grid;place-items:center;border:0;border-radius:5px;background:transparent;color:#52525b;font-size:16px;cursor:pointer}.cg-icon:hover{background:#f1f1f2;color:#18181b}.cg-icon:disabled{opacity:.4;cursor:default}.cg-canvas-wrap{position:relative;min-height:0;overflow:hidden;background-color:#fafafa;background-image:radial-gradient(#d6d6d8 1px,transparent 1px);background-size:18px 18px}.cg-canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}.cg-canvas[data-dragging=true]{cursor:grabbing}.cg-edge{fill:none;stroke:#a1a1aa;stroke-width:1.7}.cg-edge[data-type=interface],.cg-edge[data-type=affects],.cg-edge[data-type=targets]{stroke:#3b82f6}.cg-edge[data-type=dependency],.cg-edge[data-type=depends_on]{stroke:#d97706}.cg-edge[data-type=data],.cg-edge[data-type=constrains]{stroke:#8b5cf6}.cg-edge[data-type=optional]{stroke-dasharray:6 5}.cg-edge[data-type=conflicts_with]{stroke:#dc2626;stroke-dasharray:4 3}.cg-edge[data-selected=true]{stroke:#111827;stroke-width:3}.cg-edge-hit{fill:none;stroke:transparent;stroke-width:13;cursor:pointer}.cg-temp{fill:none;stroke:#2563eb;stroke-width:2;stroke-dasharray:5 4}.cg-node{cursor:move}.cg-node-box{fill:white;stroke:#d4d4d8;stroke-width:1}.cg-node[data-selected=true] .cg-node-box{stroke:#2563eb;stroke-width:2}.cg-node[data-mode=FORCE_INCLUDE] .cg-node-box{stroke:#16a34a}.cg-node[data-mode=FORCE_EXCLUDE] .cg-node-box{stroke:#dc2626}.cg-node-head{fill:#f4f4f5}.cg-node[data-node-type=requirement] .cg-node-head{fill:#dbeafe}.cg-node[data-node-type=constraint] .cg-node-head{fill:#ede9fe}.cg-node[data-node-type=decision] .cg-node-head{fill:#dcfce7}.cg-node[data-node-type=task] .cg-node-head{fill:#fef3c7}.cg-node[data-node-type=issue] .cg-node-head{fill:#fee2e2}.cg-node-title{font-size:12px;font-weight:650;fill:#18181b;pointer-events:none}.cg-node-meta{font-size:10px;fill:#71717a;pointer-events:none}.cg-port{fill:#fff;stroke:#71717a;stroke-width:2;cursor:crosshair}.cg-port:hover{fill:#2563eb;stroke:#2563eb}.cg-tools{position:absolute;left:8px;top:8px;display:flex;gap:3px;padding:3px;background:#ffffffeb;border:1px solid var(--cg-line);border-radius:6px;box-shadow:0 2px 8px #0000000d}.cg-status{position:absolute;left:9px;bottom:8px;max-width:calc(100% - 18px);padding:4px 7px;border:1px solid var(--cg-line);border-radius:4px;background:#ffffffeb;color:var(--cg-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cg-status[data-error=true]{color:#b91c1c}.cg-empty{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:var(--cg-muted);pointer-events:none}.cg-empty strong{color:#3f3f46;margin-bottom:4px}.cg-inspector{position:absolute;left:8px;right:8px;bottom:35px;max-height:48%;overflow:auto;background:#fff;border:1px solid var(--cg-line);border-radius:6px;box-shadow:0 8px 24px #00000014}.cg-inspector-head{display:flex;align-items:center;padding:8px 10px;border-bottom:1px solid var(--cg-line);font-weight:650}.cg-inspector-head span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:auto}.cg-form{padding:8px 10px}.cg-form label{display:block;margin:7px 0 3px;color:var(--cg-muted);font-size:11px}.cg-form input,.cg-form select,.cg-form textarea,.cg-compose textarea,.cg-compose select{width:100%;border:1px solid #d4d4d8;border-radius:5px;background:#fff;color:#18181b;font:inherit;padding:7px 8px;outline:none}.cg-form textarea{min-height:72px;resize:vertical}.cg-form input:focus,.cg-form select:focus,.cg-form textarea:focus,.cg-compose textarea:focus,.cg-compose select:focus{border-color:#60a5fa;box-shadow:0 0 0 2px #dbeafe}.cg-checks{display:flex;flex-wrap:wrap;gap:5px 9px}.cg-checks label{display:flex;align-items:center;gap:4px;margin:3px 0;color:#3f3f46}.cg-checks input{width:auto;box-shadow:none}.cg-row{display:flex;gap:6px}.cg-row>*{min-width:0;flex:1}.cg-danger{margin-top:8px;border:0;background:transparent;color:#dc2626;padding:5px 0;cursor:pointer}.cg-compose{padding:9px 10px 10px;border-top:1px solid var(--cg-line);background:#fff}.cg-compose-top{display:flex;gap:6px;margin-bottom:6px}.cg-compose-top select{flex:1}.cg-target{flex:1;min-width:0;color:var(--cg-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;align-self:center;font-size:11px}.cg-compose textarea{display:block;min-height:62px;max-height:140px;resize:vertical;padding-right:38px}.cg-textarea-wrap{position:relative}.cg-send{position:absolute;right:6px;bottom:6px;width:28px;height:28px;border:0;border-radius:5px;background:#18181b;color:#fff;cursor:pointer}.cg-send:disabled{opacity:.35;cursor:default}.cg-help{position:absolute;inset:12px;z-index:4;background:#fff;border:1px solid var(--cg-line);border-radius:6px;box-shadow:0 12px 34px #0002;padding:13px;overflow:auto}.cg-help h3{font-size:14px;margin:0 0 10px}.cg-help dl{display:grid;grid-template-columns:auto 1fr;gap:7px 12px;margin:0}.cg-help dt{font-family:ui-monospace,monospace;color:#18181b}.cg-help dd{margin:0;color:var(--cg-muted)}.cg-launcher{width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:5px;background:transparent;color:inherit;font-size:15px;cursor:pointer}.cg-launcher:hover{background:color-mix(in srgb,currentColor 9%,transparent)}
.cg-context-anchor{display:inline-flex;align-items:center;flex:0 0 auto;min-width:0}.cg-context-button{border:0;background:transparent;color:#374151;font:inherit;font-weight:500;padding:5px 7px;border-radius:5px;cursor:pointer;white-space:nowrap}.cg-context-button:hover,.cg-context-button[aria-expanded=true]{background:#f3f4f6;color:#111827}.cg-context-menu{position:fixed!important;z-index:50;width:324px!important;min-width:0!important;max-width:calc(100vw - 24px)!important;height:auto!important;max-height:calc(100vh - 24px)!important;overflow:auto!important;padding:12px!important;background:#fff!important;color:#1f2937!important;border:1px solid #e5e7eb!important;border-radius:8px!important;box-shadow:0 12px 30px rgb(15 23 42 / 14%)!important;font:13px/1.4 Inter,ui-sans-serif,system-ui,sans-serif!important}.cg-context-menu label{display:block!important;margin:0 0 5px!important;font-size:12px!important;font-weight:500!important;line-height:17px!important;color:#6b7280!important}.cg-context-menu select,.cg-context-menu textarea{box-sizing:border-box!important;width:100%!important;margin:0!important;border:1px solid #d1d5db!important;border-radius:6px!important;background:#fff!important;color:#1f2937!important;padding:8px 9px!important;font:13px/1.4 Inter,ui-sans-serif,system-ui,sans-serif!important;outline:none!important}.cg-context-menu select{display:block!important;height:36px!important;min-height:36px!important}.cg-context-menu textarea{display:block!important;height:96px!important;min-height:96px!important;max-height:144px!important;resize:vertical!important;line-height:1.5!important}.cg-context-menu select:focus,.cg-context-menu textarea:focus{border-color:#60a5fa!important;box-shadow:0 0 0 3px #dbeafe!important}.cg-context-target{display:flex!important;align-items:center!important;min-height:28px!important;margin:10px 0 12px!important;padding:5px 8px!important;border-radius:5px!important;background:#f8fafc!important;color:#64748b!important;font-size:12px!important;line-height:18px!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}.cg-context-menu button{display:inline-flex!important;align-items:center!important;justify-content:center!important;height:32px!important;margin:10px 0 0!important;border:0!important;border-radius:6px!important;padding:7px 10px!important;background:#2563eb!important;color:#fff!important;font:500 13px/18px Inter,ui-sans-serif,system-ui,sans-serif!important;cursor:pointer!important}.cg-context-menu button:hover{background:#1d4ed8!important}
body[data-ds-dark-theme] .cg-root{--cg-line:#34343a;--cg-muted:#a1a1aa;--cg-text:#f4f4f5;--cg-bg:#18181b;--cg-soft:#27272a}body[data-ds-dark-theme] .cg-canvas-wrap{background-color:#1c1c1f;background-image:radial-gradient(#3f3f46 1px,transparent 1px)}body[data-ds-dark-theme] .cg-node-box,body[data-ds-dark-theme] .cg-form input,body[data-ds-dark-theme] .cg-form select,body[data-ds-dark-theme] .cg-compose textarea,body[data-ds-dark-theme] .cg-compose select{fill:#202023;background:#202023;color:#f4f4f5;border-color:#3f3f46}body[data-ds-dark-theme] .cg-node-head{fill:#2b2b30}body[data-ds-dark-theme] .cg-node-title{fill:#f4f4f5}body[data-ds-dark-theme] .cg-node-meta{fill:#a1a1aa}body[data-ds-dark-theme] .cg-tools,body[data-ds-dark-theme] .cg-status,body[data-ds-dark-theme] .cg-inspector,body[data-ds-dark-theme] .cg-help{background:#202023eb;border-color:#3f3f46}body[data-ds-dark-theme] .cg-icon{color:#d4d4d8}body[data-ds-dark-theme] .cg-context-button{color:#d4d4d8}body[data-ds-dark-theme] .cg-context-button:hover,body[data-ds-dark-theme] .cg-context-button[aria-expanded=true]{background:#2b2b30;color:#fff}body[data-ds-dark-theme] .cg-context-menu{background:#202023!important;color:#f4f4f5!important;border-color:#3f3f46!important;box-shadow:0 12px 30px #0006!important}body[data-ds-dark-theme] .cg-context-menu label{color:#a1a1aa!important}body[data-ds-dark-theme] .cg-context-menu select,body[data-ds-dark-theme] .cg-context-menu textarea{background:#27272a!important;color:#f4f4f5!important;border-color:#48484f!important}body[data-ds-dark-theme] .cg-context-target{background:#29292e!important;color:#c4c4cc!important}body[data-ds-dark-theme] .cg-form textarea{background:#202023;color:#f4f4f5;border-color:#3f3f46}.cg-help dd{white-space:pre-wrap}.cg-node[data-node-type=functional] .cg-node-head{fill:#cffafe}.cg-context-check{display:flex!important;align-items:center!important;gap:7px!important;margin:0 0 9px!important;color:#374151!important;font-size:13px!important}.cg-context-check input{width:auto!important;margin:0!important;accent-color:#2563eb}body[data-ds-dark-theme] .cg-context-check{color:#e4e4e7!important}.cg-preview-heading{margin:14px 0 5px!important}.cg-preview-list{display:grid;gap:4px}.cg-preview-list>div{display:flex;align-items:center;gap:5px;min-width:0;color:var(--cg-muted);font-size:12px}.cg-preview-list span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cg-preview-list .cg-icon{width:24px;height:24px;margin-left:auto;font-size:14px;flex:0 0 auto}
`;

const TASK_WORKFLOW_STYLES = String.raw`
.cg-header{position:relative;z-index:5}.cg-node-menu-anchor{position:relative;display:inline-flex}.cg-node-menu{position:absolute;right:0;top:34px;z-index:10;display:grid;min-width:132px;padding:4px;background:#fff;border:1px solid var(--cg-line);border-radius:6px;box-shadow:0 10px 24px #00000018}.cg-node-menu-item{border:0;border-radius:4px;background:transparent;color:#27272a;padding:6px 8px;text-align:left;font:inherit;cursor:pointer}.cg-node-menu-item:hover{background:#f4f4f5;color:#111827}.cg-context-menu button:disabled{opacity:.55!important;cursor:default!important}.cg-context-actions{display:flex!important;gap:7px!important;margin-top:10px!important}.cg-context-menu .cg-context-actions button{flex:1!important;margin:0!important}.cg-context-menu button.cg-context-secondary{background:#f3f4f6!important;color:#374151!important}.cg-context-menu button.cg-context-secondary:hover{background:#e5e7eb!important}.cg-context-message{margin:8px 0 0!important;color:#64748b!important;font-size:12px!important;line-height:17px!important}.cg-context-message[data-error=true]{color:#b91c1c!important}.cg-context-divider{height:1px!important;margin:14px 0!important;background:#e5e7eb!important}.cg-canvas,.cg-canvas *{user-select:none;-webkit-user-select:none}
body[data-ds-dark-theme] .cg-node-menu{background:#202023;border-color:#3f3f46;box-shadow:0 10px 24px #0008}body[data-ds-dark-theme] .cg-node-menu-item{color:#e4e4e7}body[data-ds-dark-theme] .cg-node-menu-item:hover{background:#2b2b30;color:#fff}body[data-ds-dark-theme] .cg-context-menu button.cg-context-secondary{background:#303036!important;color:#e4e4e7!important}body[data-ds-dark-theme] .cg-context-menu button.cg-context-secondary:hover{background:#3b3b42!important}body[data-ds-dark-theme] .cg-context-divider{background:#3f3f46!important}
`;

const API = '/context-graph/api';
const TYPES = ['provides', 'consumes', 'depends_on', 'produces', 'affects', 'constrains', 'implements', 'feeds', 'transforms', 'triggers', 'related_to', 'targets', 'requires', 'constrained_by', 'applies_to', 'interface', 'implemented_by', 'derived_from', 'conflicts_with', 'supersedes', 'contains', 'uses', 'tests', 'documents', 'force_include', 'force_exclude'];
const MODES = ['AUTO', 'MANUAL', 'FORCE_INCLUDE', 'FORCE_EXCLUDE'];
const SCOPES = ['code', 'context', 'interface', 'contract', 'state', 'decisions', 'history', 'content'];
const NODE_TYPES = ['functional', 'code_module', 'implementation_file', 'implementation_class', 'implementation_function', 'implementation_package', 'implementation_symbol', 'requirement', 'task', 'constraint', 'decision', 'interface', 'documentation', 'conversation', 'artifact', 'test', 'issue', 'note', 'project_rule'];
const PRIORITIES = ['critical', 'high', 'normal', 'low'];
const STATUSES = ['active', 'resolved', 'deprecated', 'superseded', 'archived'];
const TASKS = [['develop', '开发'], ['debug', '调试'], ['refactor', '重构'], ['test', '测试'], ['review', '审查'], ['docs', '文档']];
const CREATE_NODE_TYPES = [['functional', '功能', '新建功能'], ['task', '任务', '新建任务'], ['requirement', '需求', '新建需求'], ['constraint', '约束', '新建约束'], ['decision', '决策', '新建决策'], ['issue', '问题', '新建问题'], ['note', '备注', '新建备注']];
const CONTEXT_BUDGETS = [2000, 4000, 6000, 8000, 12000, 16000];
const DEFAULT_SESSION_CONTEXT = { autoInject: true, tokenBudget: 6000, reuseContext: true, maxImplementationFiles: 2, semanticDepth: 2, include: [], exclude: [] };
const NODE_W = 178;
const NODE_H = 88;
const DOUBLE_PRESS_MS = 360;

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function edgePath(source, target) {
  const x1 = source.x + NODE_W;
  const y1 = source.y + NODE_H / 2;
  const x2 = target.x;
  const y2 = target.y + NODE_H / 2;
  const bend = Math.max(45, Math.abs(x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function graphPoint(svg, view, clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  return { x: (clientX - rect.left - view.x) / view.zoom, y: (clientY - rect.top - view.y) / view.zoom };
}

function truncateNodeText(value, maxWidth, fontSize) {
  const text = String(value || '');
  let width = 0;
  let output = '';
  for (const character of [...text]) {
    const characterWidth = character.codePointAt(0) > 255 ? fontSize : fontSize * 0.56;
    if (width + characterWidth + fontSize > maxWidth) return `${output}…`;
    output += character;
    width += characterWidth;
  }
  return output;
}

function autoLayout(graph) {
  const nodeIds = new Set(graph.nodes.map(node => node.id));
  const incoming = new Map(graph.nodes.map(node => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map(node => [node.id, []]));
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source).push(edge.target);
    incoming.set(edge.target, incoming.get(edge.target) + 1);
  }
  const levels = new Map();
  const queue = [];
  const seed = id => {
    if (levels.has(id)) return;
    levels.set(id, 0);
    queue.push(id);
  };
  for (const node of graph.nodes) if (incoming.get(node.id) === 0) seed(node.id);
  while (levels.size < graph.nodes.length) {
    while (queue.length) {
      const id = queue.shift();
      for (const target of outgoing.get(id)) {
        if (levels.has(target)) continue;
        levels.set(target, (levels.get(id) || 0) + 1);
        queue.push(target);
      }
    }
    const next = graph.nodes.find(node => !levels.has(node.id));
    if (!next) break;
    seed(next.id);
  }
  const buckets = new Map();
  for (const node of graph.nodes) {
    const level = levels.get(node.id) || 0;
    const bucket = buckets.get(level) || [];
    bucket.push(node.id);
    buckets.set(level, bucket);
  }
  return { ...graph, nodes: graph.nodes.map(node => {
    const level = levels.get(node.id) || 0;
    const bucket = buckets.get(level);
    const index = bucket.indexOf(node.id);
    const rowsPerColumn = Math.max(1, Math.floor(Math.sqrt(bucket.length)));
    const column = Math.floor(index / rowsPerColumn);
    const row = index % rowsPerColumn;
    return { ...node, x: 36 + (level + column) * 245, y: 52 + row * 126 };
  }) };
}

function fitView(graph, width, height) {
  if (!graph.nodes.length) return { x: 0, y: 0, zoom: 1 };
  const xs = graph.nodes.map(node => Number(node.x) || 0);
  const ys = graph.nodes.map(node => Number(node.y) || 0);
  const minX = Math.min(...xs); const maxX = Math.max(...xs) + NODE_W;
  const minY = Math.min(...ys); const maxY = Math.max(...ys) + NODE_H;
  const zoom = Math.min(1.2, Math.max(.3, Math.min((width - 40) / (maxX - minX), (height - 40) / (maxY - minY))));
  return { zoom, x: (width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (height - (maxY - minY) * zoom) / 2 - minY * zoom };
}

function IconButton({ label, children, onClick, disabled }) {
  return h('button', { className: 'cg-icon', type: 'button', title: label, 'aria-label': label, onClick, disabled }, children);
}

function Checks({ value = [], onChange }) {
  return h('div', { className: 'cg-checks' }, SCOPES.map(scope => h('label', { key: scope },
    h('input', { type: 'checkbox', checked: value.includes(scope), onChange: event => onChange(event.target.checked ? [...value, scope] : value.filter(item => item !== scope)) }), scope)));
}

function ContextCommand({ sessionId, projectPath, inputActions, targetStore, sendPrompt }) {
  const [open, setOpen] = useState(false);
  const [taskType, setTaskType] = useState('develop');
  const [task, setTask] = useState('');
  const [target, setTarget] = useState(() => targetStore.get(sessionId));
  const [taskTargets, setTaskTargets] = useState([]);
  const [chosenTarget, setChosenTarget] = useState('');
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetLoadError, setTargetLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [taskMessage, setTaskMessage] = useState('');
  const [taskFailed, setTaskFailed] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SESSION_CONTEXT);
  const anchorRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => targetStore.subscribe(sessionId, setTarget), [sessionId, targetStore]);
  useEffect(() => {
    let active = true;
    if (!projectPath) return undefined;
    request(`/session-settings?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}`).then(value => { if (active) setSettings(value); }).catch(() => {});
    return () => { active = false; };
  }, [projectPath, sessionId]);
  useEffect(() => {
    setChosenTarget('');
    setTaskTargets([]);
  }, [projectPath, sessionId]);
  useEffect(() => {
    if (!open || !projectPath) return undefined;
    let active = true;
    setTargetsLoading(true);
    setTargetLoadError('');
    request(`/graph?project=${encodeURIComponent(projectPath)}`).then(graph => {
      if (!active) return;
      const functional = (graph.nodes || []).filter(node => node.type === 'functional');
      setTaskTargets(functional);
      setChosenTarget(current => functional.some(node => node.id === current) ? current : '');
    }).catch(cause => {
      if (!active) return;
      setTaskTargets([]);
      setTargetLoadError(`无法加载功能节点：${cause.message}`);
    }).finally(() => { if (active) setTargetsLoading(false); });
    return () => { active = false; };
  }, [open, projectPath]);
  useEffect(() => {
    if (!open) return undefined;
    const dismiss = event => { if (!anchorRef.current?.contains(event.target)) setOpen(false); };
    const keydown = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('pointerdown', dismiss, true); window.removeEventListener('keydown', keydown); };
  }, [open]);

  const updateSettings = async patch => {
    if (!projectPath) return;
    const optimistic = { ...settings, ...patch };
    setSettings(optimistic);
    try { setSettings(await request('/session-settings', { method: 'POST', body: JSON.stringify({ projectPath, sessionId, ...patch }) })); }
    catch { setSettings(settings); }
  };
  const taskLabel = TASKS.find(([key]) => key === taskType)?.[1] || taskType;
  const addToDraft = () => {
    const content = task.trim();
    if (!content) { setTaskFailed(true); setTaskMessage('请先填写任务内容'); return; }
    const draftTarget = chosenTarget || target;
    inputActions.setDraft(`任务类型：${taskLabel}${draftTarget ? `\n目标模块：${draftTarget}` : ''}\n\n${content}`);
    setTaskMessage('');
    setTaskFailed(false);
    setOpen(false);
  };
  const createTaskAndSend = async () => {
    const content = task.trim();
    if (!content || creating) {
      if (!content) { setTaskFailed(true); setTaskMessage('请先填写任务内容'); }
      return;
    }
    if (!projectPath) { setTaskFailed(true); setTaskMessage('当前会话没有工作区'); return; }
    let persisted = false;
    setCreating(true);
    setTaskMessage('');
    setTaskFailed(false);
    try {
      const created = await request('/tasks', { method: 'POST', body: JSON.stringify({ projectPath, sessionId, content, taskType, target: chosenTarget || undefined }) });
      if (!created.task?.id) throw new Error('服务未返回新建任务');
      persisted = true;
      targetStore.set(sessionId, created.task.id);
      await sendPrompt(`任务类型：${taskLabel}\n目标模块：${created.target || '自动识别'}\n\n${content}`);
      setTask('');
      setOpen(false);
    } catch (cause) {
      setTaskFailed(true);
      setTaskMessage(persisted ? `任务已创建，但发送失败：${cause.message}` : cause.message);
    } finally {
      setCreating(false);
    }
  };

  const rect = open ? buttonRef.current?.getBoundingClientRect() : null;
  const budgetOptions = CONTEXT_BUDGETS.includes(settings.tokenBudget) ? CONTEXT_BUDGETS : [...CONTEXT_BUDGETS, settings.tokenBudget].sort((left, right) => left - right);
  const message = taskMessage || targetLoadError;
  const messageError = taskFailed || Boolean(targetLoadError);
  return h('span', { ref: anchorRef, className: 'cg-context-anchor' },
    h('button', { ref: buttonRef, type: 'button', className: 'cg-context-button', title: '上下文任务', 'aria-expanded': open, onClick: () => { setTaskMessage(''); setTaskFailed(false); setOpen(value => !value); } }, '上下文'),
    open && rect ? h('div', { className: 'cg-context-menu', role: 'dialog', 'aria-label': '上下文任务', style: { left: Math.max(12, Math.min(rect.left, window.innerWidth - 336)), bottom: window.innerHeight - rect.top + 8 } },
      h('label', null, '任务类型'),
      h('select', { value: taskType, onChange: event => setTaskType(event.target.value) }, TASKS.map(([key, label]) => h('option', { key, value: key }, label))),
      h('label', null, '目标功能'),
      h('select', { value: chosenTarget, onChange: event => setChosenTarget(event.target.value), disabled: targetsLoading },
        h('option', { value: '' }, targetsLoading ? '正在加载功能…' : '自动识别功能'),
        taskTargets.map(node => h('option', { key: node.id, value: node.id }, node.title || node.label || node.id))),
      h('label', null, '任务内容'),
      h('textarea', { value: task, placeholder: '描述需要完成的工作', onChange: event => { setTask(event.target.value); setTaskMessage(''); setTaskFailed(false); } }),
      message ? h('div', { className: 'cg-context-message', 'data-error': messageError }, message) : null,
      h('div', { className: 'cg-context-actions' },
        h('button', { className: 'cg-context-secondary', type: 'button', disabled: !task.trim() || creating, onClick: addToDraft }, '添加到输入框'),
        h('button', { className: 'cg-context-primary', type: 'button', disabled: !task.trim() || creating, onClick: () => void createTaskAndSend() }, creating ? '正在创建…' : '创建任务并发送')),
      h('div', { className: 'cg-context-divider' }),
      h('label', { className: 'cg-context-check' }, h('input', { type: 'checkbox', checked: settings.autoInject, onChange: event => void updateSettings({ autoInject: event.target.checked }) }), '自动注入当前会话'),
      h('label', null, '单轮上下文预算'),
      h('select', { value: settings.tokenBudget, onChange: event => void updateSettings({ tokenBudget: Number(event.target.value) }) }, budgetOptions.map(value => h('option', { key: value, value }, `${value} tokens`))),
      h('label', null, '相关实现文件'),
      h('select', { value: settings.maxImplementationFiles, onChange: event => void updateSettings({ maxImplementationFiles: Number(event.target.value) }) }, [1, 2, 3, 4, 5].map(value => h('option', { key: value, value }, `${value} 个`))),
      h('label', null, '语义关联层数'),
      h('select', { value: settings.semanticDepth, onChange: event => void updateSettings({ semanticDepth: Number(event.target.value) }) }, [1, 2, 3].map(value => h('option', { key: value, value }, `${value} 层`))),
      h('label', { className: 'cg-context-check' }, h('input', { type: 'checkbox', checked: settings.reuseContext, onChange: event => void updateSettings({ reuseContext: event.target.checked }) }), '复用未变化的上下文')) : null);
}

function Inspector({ graph, selected, updateNode, updateEdge, remove, showImplementation }) {
  const [position, setPosition] = useState(null);
  if (!selected) return null;
  const item = selected.kind === 'node' ? graph.nodes.find(node => node.id === selected.id) : graph.edges[selected.index];
  if (!item) return null;
  const title = selected.kind === 'node' ? (item.label || item.id) : `${item.source} → ${item.target}`;
  const implementations = selected.kind === 'node' && item.type === 'functional' ? (graph.mappings || []).filter(value => value.functional === item.id).flatMap(value => value.implementation || []) : [];
  const drag = event => { const start = { x: event.clientX, y: event.clientY, left: position?.left ?? event.currentTarget.parentElement.getBoundingClientRect().left, top: position?.top ?? event.currentTarget.parentElement.getBoundingClientRect().top }; const move = next => setPosition({ left: Math.max(8, start.left + next.clientX - start.x), top: Math.max(8, start.top + next.clientY - start.y) }); const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true }); };
  return h('section', { className: 'cg-inspector', style: position ? { left: position.left, top: position.top, right: 'auto', bottom: 'auto', width: 300 } : undefined },
    h('div', { className: 'cg-inspector-head', onPointerDown: drag }, h('span', null, title)),
    h('div', { className: 'cg-form' }, selected.kind === 'node' ? [
      h('label', { key: 'lt' }, '标题'),
      h('input', { key: 't', value: item.title || item.label || '', onChange: event => updateNode({ title: event.target.value, label: event.target.value }) }),
      h('div', { className: 'cg-row', key: 'type-row' },
        h('div', null, h('label', null, '节点类型'), h('select', { value: item.type || 'code_module', onChange: event => updateNode({ type: event.target.value }) }, NODE_TYPES.map(type => h('option', { key: type }, type)))),
        h('div', null, h('label', null, '来源'), h('input', { value: item.source || '', onChange: event => updateNode({ source: event.target.value }) }))),
      h('label', { key: 'lc' }, '内容'),
      h('textarea', { key: 'c', value: item.content || '', onChange: event => updateNode({ content: event.target.value, description: event.target.value }) }),
      item.type === 'functional' ? h('div', { key: 'implementation' }, h('label', null, 'Implementation'), h('div', { className: 'cg-context-target' }, implementations.map(value => value.path || value.id).join(' · ') || '未映射'), h('button', { type: 'button', onClick: () => showImplementation(item.id) }, '查看实现')) : null,
      h('label', { key: 'lp' }, '模块路径'),
      h('input', { key: 'p', value: item.path || '', disabled: item.type !== 'code_module', onChange: event => updateNode({ path: event.target.value }) }),
      h('div', { className: 'cg-row', key: 'state-row' },
        h('div', null, h('label', null, '优先级'), h('select', { value: item.priority || 'normal', onChange: event => updateNode({ priority: event.target.value }) }, PRIORITIES.map(priority => h('option', { key: priority }, priority)))),
        h('div', null, h('label', null, '状态'), h('select', { value: item.status || 'active', onChange: event => updateNode({ status: event.target.value }) }, STATUSES.map(status => h('option', { key: status }, status))))),
      h('label', { key: 'lm' }, '上下文模式'), h('select', { key: 'm', value: item.mode || 'AUTO', onChange: event => updateNode({ mode: event.target.value }) }, MODES.map(mode => h('option', { key: mode }, mode))),
      h('label', { key: 'ls' }, '上下文范围'),
      h(Checks, { key: 's', value: item.scope || ['interface', 'state'], onChange: scope => updateNode({ scope }) }),
    ] : [
      h('div', { className: 'cg-row', key: 'row' },
        h('div', null, h('label', null, '关系类型'), h('select', { value: item.type, onChange: event => updateEdge({ type: event.target.value }) }, TYPES.map(type => h('option', { key: type }, type)))),
        h('div', null, h('label', null, '模式'), h('select', { value: item.mode || 'AUTO', onChange: event => updateEdge({ mode: event.target.value }) }, MODES.map(mode => h('option', { key: mode }, mode))))),
      h('label', { key: 'ls' }, '传递范围'),
      h(Checks, { key: 's', value: item.scope || [], onChange: scope => updateEdge({ scope }) }),
    ], h('button', { className: 'cg-danger', type: 'button', onClick: remove }, selected.kind === 'node' ? '删除节点' : '删除连接')));
}

function GraphPanel({ sessionId, projectPath, sendPrompt, setTarget }) {
  const [graph, setGraph] = useState(null);
  const [selected, setSelected] = useState(null);
  const [inspected, setInspected] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [gesture, setGesture] = useState(null);
  const [status, setStatus] = useState('正在载入…');
  const [error, setError] = useState(false);
  const [task, setTask] = useState('');
  const [taskType, setTaskType] = useState('develop');
  const [sending, setSending] = useState(false);
  const [help, setHelp] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [previewData, setPreviewData] = useState(null);
  const [viewMode, setViewMode] = useState('semantic');
  const [implementationFocus, setImplementationFocus] = useState(null);
  const [functionalProposal, setFunctionalProposal] = useState(null);
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const svgRef = useRef(null);
  const nodeMenuRef = useRef(null);
  const graphRef = useRef(graph); graphRef.current = graph;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const pressRef = useRef({ key: '', time: 0 });

  const announce = useCallback((text, failed = false) => { setStatus(text); setError(failed); }, []);
  const load = useCallback(async () => {
    if (!projectPath) { setGraph(null); announce('当前会话没有工作区', true); return; }
    try {
      announce('正在载入…');
      const next = await request(`/graph?project=${encodeURIComponent(projectPath)}`);
      setGraph(next); setSelected(null); setInspected(null); announce(`${next.nodes.length} 个模块`);
      requestAnimationFrame(() => { const svg = svgRef.current; if (svg) setView(fitView(next, svg.clientWidth, svg.clientHeight)); });
    } catch (cause) { announce(cause.message, true); }
  }, [announce, projectPath]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!nodeMenuOpen) return undefined;
    const dismiss = event => { if (!nodeMenuRef.current?.contains(event.target)) setNodeMenuOpen(false); };
    const keydown = event => { if (event.key === 'Escape') setNodeMenuOpen(false); };
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('pointerdown', dismiss, true); window.removeEventListener('keydown', keydown); };
  }, [nodeMenuOpen]);

  const save = useCallback(async () => {
    if (!graphRef.current || !projectPath) return;
    try { announce('正在保存…'); const next = await request('/graph', { method: 'POST', body: JSON.stringify({ projectPath, graph: graphRef.current }) }); setGraph(next); announce('已保存'); }
    catch (cause) { announce(cause.message, true); }
  }, [announce, projectPath]);
  const scan = useCallback(async () => {
    if (!projectPath) return;
    try { announce('正在扫描代码…'); const result = await request('/scan', { method: 'POST', body: JSON.stringify({ projectPath }) }); setGraph(result.graph); setSelected(null); setInspected(null); const removed = result.removed?.length ? `，已移除 ${result.removed.length} 个已删除实现` : ''; announce(`扫描完成：${result.graph.nodes.length} 个模块，${result.suggestions.length} 条建议${removed}`); }
    catch (cause) { announce(cause.message, true); }
  }, [announce, projectPath]);
  const fit = useCallback(() => { const svg = svgRef.current; if (svg && graphRef.current) setView(fitView(graphRef.current, svg.clientWidth, svg.clientHeight)); }, []);
  const layout = useCallback(() => {
    if (!graphRef.current) return;
    const next = autoLayout(graphRef.current);
    setGraph(next);
    requestAnimationFrame(() => { const svg = svgRef.current; if (svg) setView(fitView(next, svg.clientWidth, svg.clientHeight)); });
    announce('已自动排布，保存后生效');
  }, [announce]);
  const remove = useCallback(() => {
    const current = selectedRef.current; if (!current) return;
    setGraph(previous => current.kind === 'node'
      ? { ...previous, nodes: previous.nodes.filter(node => node.id !== current.id), edges: previous.edges.filter(edge => edge.source !== current.id && edge.target !== current.id), mappings: (previous.mappings || []).map(mapping => ({ ...mapping, implementation: (mapping.implementation || []).filter(item => (typeof item === 'string' ? item : item.id) !== current.id) })).filter(mapping => mapping.functional !== current.id && mapping.implementation.length > 0) }
      : { ...previous, edges: previous.edges.filter((_edge, index) => index !== current.index) });
    setSelected(null); setInspected(null); announce('已删除，保存后生效');
  }, [announce]);
  const addNode = useCallback(type => {
    const template = CREATE_NODE_TYPES.find(([key]) => key === type);
    if (!template) return;
    if (!graphRef.current) { announce('图谱尚未载入', true); return; }
    const [, label, title] = template;
    const ids = new Set(graphRef.current.nodes.map(node => node.id));
    const baseId = `${type}-${Date.now().toString(36)}`;
    let id = baseId; let suffix = 2;
    while (ids.has(id)) { id = `${baseId}-${suffix}`; suffix += 1; }
    const node = { id, type, title, label: title, content: '', description: '', source: 'user', priority: 'normal', status: 'active', mode: 'MANUAL', metadata: { layer: type === 'functional' ? 'functional' : 'structured' }, x: Math.max(40, (120 - view.x) / view.zoom), y: Math.max(40, (100 - view.y) / view.zoom) };
    setGraph(previous => ({ ...previous, nodes: [...previous.nodes, node] }));
    setNodeMenuOpen(false);
    setSelected({ kind: 'node', id });
    setInspected({ kind: 'node', id });
    announce(`已创建${label}节点，编辑后保存`);
  }, [announce, view]);
  const getSessionSettings = useCallback(async () => {
    if (!projectPath) return DEFAULT_SESSION_CONTEXT;
    try { return await request(`/session-settings?project=${encodeURIComponent(projectPath)}&sessionId=${encodeURIComponent(sessionId)}`); }
    catch { return DEFAULT_SESSION_CONTEXT; }
  }, [projectPath, sessionId]);
  const updateSessionSettings = useCallback(async patch => {
    if (!projectPath) return DEFAULT_SESSION_CONTEXT;
    return request('/session-settings', { method: 'POST', body: JSON.stringify({ projectPath, sessionId, ...patch }) });
  }, [projectPath, sessionId]);
  const showPreview = useCallback(async () => {
    const entry = selectedRef.current?.kind === 'node' ? selectedRef.current.id : null;
    if (!entry) { announce('请先选择一个入口节点', true); return; }
    try { const settings = await getSessionSettings(); const previewTask = task.trim() || `预览 ${entry}`; const result = await request('/compile', { method: 'POST', body: JSON.stringify({ projectPath, graph: graphRef.current, entry, task: previewTask, tokenBudget: settings.tokenBudget, maxImplementationFiles: settings.maxImplementationFiles, semanticDepth: settings.semanticDepth, include: settings.include, exclude: settings.exclude }) }); setPreviewData({ ...result, sessionSettings: settings, previewTask }); }
    catch (cause) { announce(cause.message, true); }
  }, [announce, getSessionSettings, projectPath, task]);
  const excludeFromPreview = useCallback(async id => {
    const entry = selectedRef.current?.kind === 'node' ? selectedRef.current.id : null;
    if (!id || id === entry) return;
    try { const settings = previewData?.sessionSettings || await getSessionSettings(); const exclude = [...new Set([...(settings.exclude || []), id])]; await updateSessionSettings({ exclude }); announce(`本会话已排除 ${id}`); void showPreview(); }
    catch (cause) { announce(cause.message, true); }
  }, [announce, getSessionSettings, previewData, showPreview, updateSessionSettings]);
  const restorePreviewNode = useCallback(async id => {
    try { const settings = previewData?.sessionSettings || await getSessionSettings(); await updateSessionSettings({ exclude: (settings.exclude || []).filter(item => item !== id) }); announce(`已恢复 ${id}`); void showPreview(); }
    catch (cause) { announce(cause.message, true); }
  }, [announce, getSessionSettings, previewData, showPreview, updateSessionSettings]);
  const inferFunctional = useCallback(async apply => {
    if (!projectPath) return;
    try { const result = await request('/functional-infer', { method: 'POST', body: JSON.stringify({ projectPath, apply }) }); if (result.applied) { setGraph(result.graph); setFunctionalProposal(null); announce(`已加入 ${result.proposal.nodes.length} 个功能节点`); } else setFunctionalProposal(result.proposal); }
    catch (cause) { announce(cause.message, true); }
  }, [announce, projectPath]);
  const submit = useCallback(async () => {
    const text = task.trim(); if (!text || sending) return;
    const taskLabel = TASKS.find(([key]) => key === taskType)?.[1] || taskType;
    const target = selected?.kind === 'node' ? `\n目标模块：${selected.id}` : '';
    setSending(true);
    try { await sendPrompt(`任务类型：${taskLabel}${target}\n\n${text}`); setTask(''); announce('任务已发送到当前会话'); }
    catch (cause) { announce(cause.message, true); }
    finally { setSending(false); }
  }, [announce, selected, sendPrompt, sending, task, taskType]);

  useEffect(() => {
    const keydown = event => {
      const editing = /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName || '');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
      else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void submit(); }
      else if (!editing && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); remove(); }
      else if (!editing && event.key.toLowerCase() === 'f') fit();
      else if (!editing && event.key.toLowerCase() === 'a') layout();
      else if (event.key === 'Escape') { setGesture(null); setSelected(null); setInspected(null); setHelp(false); setPreviewData(null); setFunctionalProposal(null); setNodeMenuOpen(false); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [fit, layout, remove, save, submit]);

  const visibleNodes = useMemo(() => {
    const mapped = new Set((graph?.mappings || []).filter(mapping => !implementationFocus || mapping.functional === implementationFocus).flatMap(mapping => mapping.implementation.map(item => item.id)));
    const preview = new Set((previewData?.included || []).map(item => item.node || item.module));
    return (graph?.nodes || []).filter(node => {
      const type = node.type || 'code_module'; const implementation = type === 'code_module' || type.startsWith('implementation_');
      const visible = viewMode === 'semantic' ? !implementation && type !== 'conversation' : viewMode === 'implementation' ? implementationFocus ? mapped.has(node.id) || node.id === implementationFocus : implementation : preview.has(node.id);
      return visible && (typeFilter === 'all' || type === typeFilter) && (!search.trim() || `${node.title || node.label || node.id} ${node.content || ''} ${node.path || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
    });
  }, [graph, implementationFocus, previewData, search, typeFilter, viewMode]);
  const displayEdges = useMemo(() => {
    const visible = new Set(visibleNodes.map(node => node.id)); const mapEdges = viewMode === 'implementation' ? (graph?.mappings || []).filter(mapping => !implementationFocus || mapping.functional === implementationFocus).flatMap(mapping => mapping.implementation.map(item => ({ source: mapping.functional, target: item.id, type: 'implemented_by', scope: [], mode: mapping.mode || 'AUTO' }))) : [];
    return [...(graph?.edges || []).map((edge, index) => ({ ...edge, _index: index })), ...mapEdges].filter(edge => visible.has(edge.source) && visible.has(edge.target));
  }, [graph, implementationFocus, viewMode, visibleNodes]);
  const nodes = useMemo(() => new Map(visibleNodes.map(node => [node.id, node])), [visibleNodes]);
  const updateNode = patch => setGraph(previous => ({ ...previous, nodes: previous.nodes.map(node => node.id === inspected.id ? { ...node, ...patch } : node) }));
  const updateEdge = patch => setGraph(previous => ({ ...previous, edges: previous.edges.map((edge, index) => index === inspected.index ? { ...edge, ...patch } : edge) }));
  const selectItem = item => {
    const key = item.kind === 'node' ? `node:${item.id}` : `edge:${item.index}`;
    const now = Date.now();
    const doublePressed = pressRef.current.key === key && now - pressRef.current.time <= DOUBLE_PRESS_MS;
    pressRef.current = { key, time: now };
    setSelected(item);
    if (item.kind === 'node') setTarget(item.id);
    setInspected(doublePressed ? item : null);
  };
  const point = event => graphPoint(svgRef.current, view, event.clientX, event.clientY);
  const startPan = event => { if (event.button !== 0) return; event.preventDefault(); pressRef.current = { key: '', time: 0 }; event.currentTarget.setPointerCapture(event.pointerId); setSelected(null); setInspected(null); setGesture({ kind: 'pan', startX: event.clientX, startY: event.clientY, x: view.x, y: view.y }); };
  const move = event => {
    if (!gesture) return;
    if (gesture.kind === 'pan') setView(current => ({ ...current, x: gesture.x + event.clientX - gesture.startX, y: gesture.y + event.clientY - gesture.startY }));
    if (gesture.kind === 'node') { const p = point(event); setGraph(previous => ({ ...previous, nodes: previous.nodes.map(node => node.id === gesture.id ? { ...node, x: p.x - gesture.dx, y: p.y - gesture.dy } : node) })); }
    if (gesture.kind === 'connect') setGesture({ ...gesture, point: point(event) });
  };
  const stop = event => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setGesture(null); };
  const connect = target => {
    if (gesture?.kind !== 'connect' || gesture.source === target) { setGesture(null); return; }
    setGraph(previous => previous.edges.some(edge => edge.source === gesture.source && edge.target === target) ? previous : ({ ...previous, edges: [...previous.edges, { source: gesture.source, target, type: 'related_to', scope: ['content'], mode: 'MANUAL' }] }));
    setGesture(null); announce('已创建连接，保存后生效');
  };

  return h('div', { className: 'cg-root' },
    h('header', { className: 'cg-header' },
      h('div', { className: 'cg-title' }, '上下文图谱'),
      h('select', { className: 'cg-filter', value: viewMode, onChange: event => { setViewMode(event.target.value); setImplementationFocus(null); } }, h('option', { value: 'semantic' }, '语义'), h('option', { value: 'implementation' }, '实现'), h('option', { value: 'context' }, '当前上下文')),
      h('input', { className: 'cg-search', value: search, placeholder: '搜索节点', onChange: event => setSearch(event.target.value) }),
      h('select', { className: 'cg-filter', value: typeFilter, onChange: event => setTypeFilter(event.target.value) }, h('option', { value: 'all' }, '全部类型'), NODE_TYPES.map(type => h('option', { key: type, value: type }, type))),
      h('span', { ref: nodeMenuRef, className: 'cg-node-menu-anchor' },
        h(IconButton, { label: '新建节点', onClick: () => setNodeMenuOpen(value => !value) }, '+'),
        nodeMenuOpen ? h('div', { className: 'cg-node-menu', role: 'menu', 'aria-label': '新建节点类型' }, CREATE_NODE_TYPES.map(([type, label]) => h('button', { key: type, className: 'cg-node-menu-item', type: 'button', role: 'menuitem', onClick: () => addNode(type) }, label))) : null),
      h(IconButton, { label: '推断功能模块', onClick: () => void inferFunctional(false) }, '◇'),
      h(IconButton, { label: 'Context Preview', onClick: showPreview }, '◎'),
      h(IconButton, { label: '扫描代码', onClick: scan }, '↻'),
      h(IconButton, { label: '保存 (Ctrl+S)', onClick: save }, '⌑'),
      h(IconButton, { label: '快捷键', onClick: () => setHelp(value => !value) }, '?')),
    h('div', { className: 'cg-canvas-wrap' },
      h('svg', { ref: svgRef, className: 'cg-canvas', 'data-dragging': Boolean(gesture), onPointerDown: startPan, onPointerMove: move, onPointerUp: stop, onPointerCancel: stop,
        onWheel: event => { event.preventDefault(); const before = point(event); const zoom = Math.min(2, Math.max(.25, view.zoom * (event.deltaY > 0 ? .9 : 1.1))); const rect = svgRef.current.getBoundingClientRect(); setView({ zoom, x: event.clientX - rect.left - before.x * zoom, y: event.clientY - rect.top - before.y * zoom }); } },
        h('defs', null, h('marker', { id: 'cg-arrow', markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto' }, h('path', { d: 'M0,0 L8,4 L0,8 Z', fill: 'context-stroke' }))),
        h('g', { transform: `translate(${view.x} ${view.y}) scale(${view.zoom})` },
          displayEdges.map((edge, index) => { const source = nodes.get(edge.source); const target = nodes.get(edge.target); if (!source || !target) return null; const d = edgePath(source, target); return h('g', { key: `${edge.source}-${edge.target}-${edge.type}-${index}`, onPointerDown: event => { event.preventDefault(); event.stopPropagation(); if (edge._index !== undefined) selectItem({ kind: 'edge', index: edge._index }); } }, h('path', { d, className: 'cg-edge-hit' }), h('path', { d, className: 'cg-edge', 'data-type': edge.type, 'data-selected': selected?.kind === 'edge' && selected.index === edge._index, markerEnd: 'url(#cg-arrow)' })); }),
          gesture?.kind === 'connect' && nodes.get(gesture.source) ? h('path', { className: 'cg-temp', d: edgePath(nodes.get(gesture.source), { x: gesture.point.x, y: gesture.point.y - NODE_H / 2 }) }) : null,
          visibleNodes.map(node => h('g', { key: node.id, className: 'cg-node', transform: `translate(${node.x || 0} ${node.y || 0})`, 'data-selected': selected?.kind === 'node' && selected.id === node.id, 'data-mode': node.mode || 'AUTO', 'data-node-type': node.type || 'code_module',
            onPointerDown: event => { event.preventDefault(); event.stopPropagation(); const p = point(event); svgRef.current.setPointerCapture(event.pointerId); selectItem({ kind: 'node', id: node.id }); setGesture({ kind: 'node', id: node.id, dx: p.x - (node.x || 0), dy: p.y - (node.y || 0) }); } },
            h('rect', { className: 'cg-node-box', width: NODE_W, height: NODE_H, rx: 5 }),
            h('path', { className: 'cg-node-head', d: `M5 0 H${NODE_W - 5} Q${NODE_W} 0 ${NODE_W} 5 V28 H0 V5 Q0 0 5 0` }),
            h('text', { className: 'cg-node-title', x: 11, y: 19 }, truncateNodeText(node.label || node.id, NODE_W - 22, 12)),
            h('text', { className: 'cg-node-meta', x: 11, y: 48 }, truncateNodeText(node.type === 'code_module' || !node.type ? node.path || '未设置路径' : node.type, NODE_W - 22, 10)),
            h('text', { className: 'cg-node-meta', x: 11, y: 69 }, truncateNodeText(node.type === 'code_module' || !node.type ? node.mode || 'AUTO' : `${node.priority || 'normal'} · ${node.status || 'active'}`, NODE_W - 22, 10)),
            h('circle', { className: 'cg-port', cx: 0, cy: NODE_H / 2, r: 6, onPointerDown: event => { event.preventDefault(); event.stopPropagation(); }, onPointerUp: event => { event.preventDefault(); event.stopPropagation(); connect(node.id); } }),
            h('circle', { className: 'cg-port', cx: NODE_W, cy: NODE_H / 2, r: 6, onPointerDown: event => { event.preventDefault(); event.stopPropagation(); setSelected({ kind: 'node', id: node.id }); setInspected(null); setGesture({ kind: 'connect', source: node.id, point: point(event) }); } }))),
        )),
      h('div', { className: 'cg-tools' }, h(IconButton, { label: '放大', onClick: () => setView(current => ({ ...current, zoom: Math.min(2, current.zoom * 1.15) })) }, '+'), h(IconButton, { label: '缩小', onClick: () => setView(current => ({ ...current, zoom: Math.max(.25, current.zoom / 1.15) })) }, '−'), h(IconButton, { label: '适合画布 (F)', onClick: fit }, '□'), h(IconButton, { label: '自动排布 (A)', onClick: layout }, '≡')),
      !visibleNodes.length ? h('div', { className: 'cg-empty' }, h('strong', null, graph?.nodes.length ? '没有匹配节点' : '暂无上下文节点'), h('span', null, graph?.nodes.length ? '调整搜索或类型筛选' : '扫描代码或新建上下文节点')) : null,
      h('div', { className: 'cg-status', 'data-error': error }, status),
      h(Inspector, { graph: graph || { nodes: [], edges: [], mappings: [] }, selected: inspected, updateNode, updateEdge, remove, showImplementation: id => { setImplementationFocus(id); setViewMode('implementation'); } }),
      help ? h('section', { className: 'cg-help' }, h('h3', null, '快捷键'), h('dl', null,
        h('dt', null, 'Ctrl/⌘ + S'), h('dd', null, '保存图谱'), h('dt', null, 'Ctrl/⌘ + Enter'), h('dd', null, '发送任务'), h('dt', null, 'Delete'), h('dd', null, '删除所选节点或连接'), h('dt', null, 'F'), h('dd', null, '适合画布'), h('dt', null, 'A'), h('dd', null, '自动排布'), h('dt', null, 'Esc'), h('dd', null, '取消连接或选择'), h('dt', null, '拖动端口'), h('dd', null, '手动创建连接'))) : null,
      previewData ? h('section', { className: 'cg-help' }, h('h3', null, `Context Preview · ${previewData.entry || previewData.target}`), h('dl', null, h('dt', null, '预算'), h('dd', null, `${previewData.estimatedTokens} / ${previewData.tokenBudget} Tokens${previewData.overBudget ? '（已超预算）' : ''}`), h('dt', null, '任务'), h('dd', null, previewData.previewTask || '无')), h('h3', { className: 'cg-preview-heading' }, '已包含'), h('div', { className: 'cg-preview-list' }, previewData.included.length ? previewData.included.map((item, index) => h('div', { key: `${item.node || item.module}-${item.scope}-${index}` }, h('span', null, `${item.node || item.module}:${item.scope} · ${item.tokens || 0} tokens (${item.reason || 'selected'})`), item.node !== (previewData.entry || previewData.target) && item.scope !== 'task' ? h(IconButton, { label: `本会话排除 ${item.node || item.module}`, onClick: () => void excludeFromPreview(item.node || item.module) }, '×') : null)) : h('span', null, '无')), h('h3', { className: 'cg-preview-heading' }, '已排除'), h('div', { className: 'cg-preview-list' }, previewData.excluded.length ? previewData.excluded.map((item, index) => h('div', { key: `${item.node || item.module}-${item.reason}-${index}` }, h('span', null, `${item.node || item.module}:${item.reason}`), item.reason === 'FORCE_EXCLUDE' ? null : h(IconButton, { label: `恢复 ${item.node || item.module}`, onClick: () => void restorePreviewNode(item.node || item.module) }, '↺'))) : h('span', null, '无')), h('button', { className: 'cg-danger', type: 'button', onClick: () => setPreviewData(null) }, '关闭')) : null,
      functionalProposal ? h('section', { className: 'cg-help' }, h('h3', null, '功能模块推断'), h('p', null, functionalProposal.nodes.map(node => `${node.title} ← ${functionalProposal.mappings.find(mapping => mapping.functional === node.id)?.implementation.map(item => item.path || item.id).join(', ') || ''}`).join('\n') || '没有可提议的功能模块'), h('button', { type: 'button', onClick: () => void inferFunctional(true) }, '确认加入图谱'), h('button', { className: 'cg-danger', type: 'button', onClick: () => setFunctionalProposal(null) }, '关闭')) : null),
    );
}

const inject = ['slots', 'sessions'];

function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.contextGraph = 'true';
    style.textContent = `${styles}${TASK_WORKFLOW_STYLES}`;
    document.head.append(style);
    return () => style.remove();
  }, 'context-graph: styles');

  ctx.inject(['slots', 'sessions', 'conversation'], scope => {
    const targetListeners = new Map(); const targets = new Map();
    const targetStore = { get: id => targets.get(id) || '', set: (id, value) => { targets.set(id, value); for (const listener of targetListeners.get(id) || []) listener(value); }, subscribe: (id, listener) => { const listeners = targetListeners.get(id) || new Set(); listeners.add(listener); targetListeners.set(id, listeners); return () => listeners.delete(listener); } };
    const sendSessionPrompt = async (sessionId, text) => {
      const sessionScope = scope.sessions.scope(sessionId);
      const conversation = sessionScope?.get('conversation');
      if (!conversation) throw new Error('当前会话尚未准备好');
      await conversation.send(text);
    };
    const disposeContext = scope.slots.inject('conversation.input.left', () => scope.slots.register({ name: 'conversation.input.left', id: 'context-graph-task', order: 100, registrant: 'dsh-context-graph', inject: sessionId => ({ sessionId, projectPath: scope.sessions.list.getSnapshot().byId[sessionId]?.cwd || '', targetStore, sendPrompt: text => sendSessionPrompt(sessionId, text) }) }, ContextCommand));
    const disposeView = scope.slots.inject('conversation.view', () => scope.slots.register({
      name: 'conversation.view',
      id: 'context-graph',
      order: 20,
      label: () => '上下文图谱',
      registrant: 'dsh-context-graph',
      inject: sessionId => {
        const projectPath = scope.sessions.list.getSnapshot().byId[sessionId]?.cwd || '';
        return {
          sessionId,
          projectPath,
          setTarget: value => targetStore.set(sessionId, value),
          sendPrompt: text => sendSessionPrompt(sessionId, text),
        };
      },
    }, GraphPanel));
    return () => { disposeContext(); disposeView(); };
  });
}

return { inject, apply };
    },
  });
})();
