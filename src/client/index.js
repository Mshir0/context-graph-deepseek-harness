import { createElement as h, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { styles } from './styles.js';

const API = '/context-graph/api';
const TYPES = ['dependency', 'reference', 'interface', 'data', 'optional', 'force_include', 'force_exclude'];
const MODES = ['AUTO', 'FORCE_INCLUDE', 'FORCE_EXCLUDE'];
const SCOPES = ['code', 'context', 'interface', 'state', 'decisions', 'history'];
const TASKS = [['develop', '开发'], ['debug', '调试'], ['refactor', '重构'], ['test', '测试'], ['review', '审查'], ['docs', '文档']];
const NODE_W = 178;
const NODE_H = 88;

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

function autoLayout(graph) {
  const incoming = new Map(graph.nodes.map(node => [node.id, 0]));
  for (const edge of graph.edges) incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
  const queue = graph.nodes.filter(node => !incoming.get(node.id)).map(node => node.id);
  const levels = new Map(queue.map(id => [id, 0]));
  while (queue.length) {
    const id = queue.shift();
    for (const edge of graph.edges.filter(item => item.source === id)) {
      if (levels.has(edge.target)) continue;
      levels.set(edge.target, (levels.get(id) || 0) + 1);
      queue.push(edge.target);
    }
  }
  const rows = new Map();
  return { ...graph, nodes: graph.nodes.map(node => {
    const level = levels.get(node.id) || 0;
    const row = rows.get(level) || 0;
    rows.set(level, row + 1);
    return { ...node, x: 36 + level * 245, y: 52 + row * 126 };
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

function GraphLauncher({ open }) {
  return h('button', { className: 'cg-launcher', type: 'button', title: '打开上下文图谱', 'aria-label': '打开上下文图谱', onClick: open }, '⌘');
}

function Checks({ value = [], onChange }) {
  return h('div', { className: 'cg-checks' }, SCOPES.map(scope => h('label', { key: scope },
    h('input', { type: 'checkbox', checked: value.includes(scope), onChange: event => onChange(event.target.checked ? [...value, scope] : value.filter(item => item !== scope)) }), scope)));
}

function Inspector({ graph, selected, updateNode, updateEdge, remove }) {
  if (!selected) return null;
  const item = selected.kind === 'node' ? graph.nodes.find(node => node.id === selected.id) : graph.edges[selected.index];
  if (!item) return null;
  const title = selected.kind === 'node' ? (item.label || item.id) : `${item.source} → ${item.target}`;
  return h('section', { className: 'cg-inspector' },
    h('div', { className: 'cg-inspector-head' }, h('span', null, title)),
    h('div', { className: 'cg-form' }, selected.kind === 'node' ? [
      h('label', { key: 'lp' }, '模块路径'),
      h('input', { key: 'p', value: item.path || '', onChange: event => updateNode({ path: event.target.value }) }),
      h('label', { key: 'lm' }, '上下文模式'),
      h('select', { key: 'm', value: item.mode || 'AUTO', onChange: event => updateNode({ mode: event.target.value }) }, MODES.map(mode => h('option', { key: mode }, mode))),
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

function GraphPanel({ sessionId, projectPath, sendPrompt }) {
  const [graph, setGraph] = useState(null);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [gesture, setGesture] = useState(null);
  const [status, setStatus] = useState('正在载入…');
  const [error, setError] = useState(false);
  const [task, setTask] = useState('');
  const [taskType, setTaskType] = useState('develop');
  const [sending, setSending] = useState(false);
  const [help, setHelp] = useState(false);
  const svgRef = useRef(null);
  const graphRef = useRef(graph); graphRef.current = graph;
  const selectedRef = useRef(selected); selectedRef.current = selected;

  const announce = useCallback((text, failed = false) => { setStatus(text); setError(failed); }, []);
  const load = useCallback(async () => {
    if (!projectPath) { setGraph(null); announce('当前会话没有工作区', true); return; }
    try {
      announce('正在载入…');
      const next = await request(`/graph?project=${encodeURIComponent(projectPath)}`);
      setGraph(next); setSelected(null); announce(`${next.nodes.length} 个模块`);
      requestAnimationFrame(() => { const svg = svgRef.current; if (svg) setView(fitView(next, svg.clientWidth, svg.clientHeight)); });
    } catch (cause) { announce(cause.message, true); }
  }, [announce, projectPath]);
  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (!graphRef.current || !projectPath) return;
    try { announce('正在保存…'); const next = await request('/graph', { method: 'POST', body: JSON.stringify({ projectPath, graph: graphRef.current }) }); setGraph(next); announce('已保存'); }
    catch (cause) { announce(cause.message, true); }
  }, [announce, projectPath]);
  const scan = useCallback(async () => {
    if (!projectPath) return;
    try { announce('正在扫描代码…'); const result = await request('/scan', { method: 'POST', body: JSON.stringify({ projectPath }) }); setGraph(result.graph); announce(`扫描完成：${result.graph.nodes.length} 个模块，${result.suggestions.length} 条建议`); }
    catch (cause) { announce(cause.message, true); }
  }, [announce, projectPath]);
  const fit = useCallback(() => { const svg = svgRef.current; if (svg && graphRef.current) setView(fitView(graphRef.current, svg.clientWidth, svg.clientHeight)); }, []);
  const layout = useCallback(() => { if (graphRef.current) { const next = autoLayout(graphRef.current); setGraph(next); requestAnimationFrame(fit); announce('已自动排布，保存后生效'); } }, [announce, fit]);
  const remove = useCallback(() => {
    const current = selectedRef.current; if (!current) return;
    setGraph(previous => current.kind === 'node'
      ? { ...previous, nodes: previous.nodes.filter(node => node.id !== current.id), edges: previous.edges.filter(edge => edge.source !== current.id && edge.target !== current.id) }
      : { ...previous, edges: previous.edges.filter((_edge, index) => index !== current.index) });
    setSelected(null); announce('已删除，保存后生效');
  }, [announce]);
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
      else if (event.key === 'Escape') { setGesture(null); setSelected(null); setHelp(false); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [fit, layout, remove, save, submit]);

  const nodes = useMemo(() => new Map((graph?.nodes || []).map(node => [node.id, node])), [graph]);
  const updateNode = patch => setGraph(previous => ({ ...previous, nodes: previous.nodes.map(node => node.id === selected.id ? { ...node, ...patch } : node) }));
  const updateEdge = patch => setGraph(previous => ({ ...previous, edges: previous.edges.map((edge, index) => index === selected.index ? { ...edge, ...patch } : edge) }));
  const point = event => graphPoint(svgRef.current, view, event.clientX, event.clientY);
  const startPan = event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); setSelected(null); setGesture({ kind: 'pan', startX: event.clientX, startY: event.clientY, x: view.x, y: view.y }); };
  const move = event => {
    if (!gesture) return;
    if (gesture.kind === 'pan') setView(current => ({ ...current, x: gesture.x + event.clientX - gesture.startX, y: gesture.y + event.clientY - gesture.startY }));
    if (gesture.kind === 'node') { const p = point(event); setGraph(previous => ({ ...previous, nodes: previous.nodes.map(node => node.id === gesture.id ? { ...node, x: p.x - gesture.dx, y: p.y - gesture.dy } : node) })); }
    if (gesture.kind === 'connect') setGesture({ ...gesture, point: point(event) });
  };
  const stop = event => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); setGesture(null); };
  const connect = target => {
    if (gesture?.kind !== 'connect' || gesture.source === target) { setGesture(null); return; }
    setGraph(previous => previous.edges.some(edge => edge.source === gesture.source && edge.target === target) ? previous : ({ ...previous, edges: [...previous.edges, { source: gesture.source, target, type: 'interface', scope: ['interface'], mode: 'AUTO' }] }));
    setGesture(null); announce('已创建连接，保存后生效');
  };

  return h('div', { className: 'cg-root' },
    h('header', { className: 'cg-header' },
      h('div', { className: 'cg-title' }, '上下文图谱'),
      h(IconButton, { label: '扫描代码', onClick: scan }, '↻'),
      h(IconButton, { label: '保存 (Ctrl+S)', onClick: save }, '⌑'),
      h(IconButton, { label: '快捷键', onClick: () => setHelp(value => !value) }, '?'),
      h(IconButton, { label: '关闭右栏', onClick: () => window.dispatchEvent(new CustomEvent('context-graph:close')) }, '×')),
    h('div', { className: 'cg-canvas-wrap' },
      h('svg', { ref: svgRef, className: 'cg-canvas', 'data-dragging': Boolean(gesture), onPointerDown: startPan, onPointerMove: move, onPointerUp: stop, onPointerCancel: stop,
        onWheel: event => { event.preventDefault(); const before = point(event); const zoom = Math.min(2, Math.max(.25, view.zoom * (event.deltaY > 0 ? .9 : 1.1))); const rect = svgRef.current.getBoundingClientRect(); setView({ zoom, x: event.clientX - rect.left - before.x * zoom, y: event.clientY - rect.top - before.y * zoom }); } },
        h('defs', null, h('marker', { id: 'cg-arrow', markerWidth: 8, markerHeight: 8, refX: 7, refY: 4, orient: 'auto' }, h('path', { d: 'M0,0 L8,4 L0,8 Z', fill: 'context-stroke' }))),
        h('g', { transform: `translate(${view.x} ${view.y}) scale(${view.zoom})` },
          (graph?.edges || []).map((edge, index) => { const source = nodes.get(edge.source); const target = nodes.get(edge.target); if (!source || !target) return null; const d = edgePath(source, target); return h('g', { key: `${edge.source}-${edge.target}-${index}`, onPointerDown: event => { event.stopPropagation(); setSelected({ kind: 'edge', index }); } }, h('path', { d, className: 'cg-edge-hit' }), h('path', { d, className: 'cg-edge', 'data-type': edge.type, 'data-selected': selected?.kind === 'edge' && selected.index === index, markerEnd: 'url(#cg-arrow)' })); }),
          gesture?.kind === 'connect' && nodes.get(gesture.source) ? h('path', { className: 'cg-temp', d: edgePath(nodes.get(gesture.source), { x: gesture.point.x, y: gesture.point.y - NODE_H / 2 }) }) : null,
          (graph?.nodes || []).map(node => h('g', { key: node.id, className: 'cg-node', transform: `translate(${node.x || 0} ${node.y || 0})`, 'data-selected': selected?.kind === 'node' && selected.id === node.id, 'data-mode': node.mode || 'AUTO',
            onPointerDown: event => { event.stopPropagation(); const p = point(event); svgRef.current.setPointerCapture(event.pointerId); setSelected({ kind: 'node', id: node.id }); setGesture({ kind: 'node', id: node.id, dx: p.x - (node.x || 0), dy: p.y - (node.y || 0) }); } },
            h('rect', { className: 'cg-node-box', width: NODE_W, height: NODE_H, rx: 5 }),
            h('path', { className: 'cg-node-head', d: `M5 0 H${NODE_W - 5} Q${NODE_W} 0 ${NODE_W} 5 V28 H0 V5 Q0 0 5 0` }),
            h('text', { className: 'cg-node-title', x: 11, y: 19 }, (node.label || node.id).slice(0, 25)),
            h('text', { className: 'cg-node-meta', x: 11, y: 48 }, (node.path || '未设置路径').slice(0, 29)),
            h('text', { className: 'cg-node-meta', x: 11, y: 69 }, node.mode || 'AUTO'),
            h('circle', { className: 'cg-port', cx: 0, cy: NODE_H / 2, r: 6, onPointerDown: event => event.stopPropagation(), onPointerUp: event => { event.stopPropagation(); connect(node.id); } }),
            h('circle', { className: 'cg-port', cx: NODE_W, cy: NODE_H / 2, r: 6, onPointerDown: event => { event.stopPropagation(); setSelected({ kind: 'node', id: node.id }); setGesture({ kind: 'connect', source: node.id, point: point(event) }); } }))),
        )),
      h('div', { className: 'cg-tools' }, h(IconButton, { label: '放大', onClick: () => setView(current => ({ ...current, zoom: Math.min(2, current.zoom * 1.15) })) }, '+'), h(IconButton, { label: '缩小', onClick: () => setView(current => ({ ...current, zoom: Math.max(.25, current.zoom / 1.15) })) }, '−'), h(IconButton, { label: '适合画布 (F)', onClick: fit }, '□'), h(IconButton, { label: '自动排布 (A)', onClick: layout }, '≡')),
      !graph?.nodes.length ? h('div', { className: 'cg-empty' }, h('strong', null, '暂无模块'), h('span', null, '点击扫描代码生成图谱')) : null,
      h('div', { className: 'cg-status', 'data-error': error }, status),
      h(Inspector, { graph: graph || { nodes: [], edges: [] }, selected, updateNode, updateEdge, remove }),
      help ? h('section', { className: 'cg-help' }, h('h3', null, '快捷键'), h('dl', null,
        h('dt', null, 'Ctrl/⌘ + S'), h('dd', null, '保存图谱'), h('dt', null, 'Ctrl/⌘ + Enter'), h('dd', null, '发送任务'), h('dt', null, 'Delete'), h('dd', null, '删除所选节点或连接'), h('dt', null, 'F'), h('dd', null, '适合画布'), h('dt', null, 'A'), h('dd', null, '自动排布'), h('dt', null, 'Esc'), h('dd', null, '取消连接或选择'), h('dt', null, '拖动端口'), h('dd', null, '手动创建连接'))) : null),
    h('footer', { className: 'cg-compose' },
      h('div', { className: 'cg-compose-top' }, h('select', { value: taskType, onChange: event => setTaskType(event.target.value), 'aria-label': '任务类型' }, TASKS.map(([key, label]) => h('option', { key, value: key }, label))), h('div', { className: 'cg-target', title: selected?.kind === 'node' ? selected.id : '' }, selected?.kind === 'node' ? `目标：${selected.id}` : '自动识别目标模块')),
      h('div', { className: 'cg-textarea-wrap' }, h('textarea', { value: task, placeholder: '输入任务提示词…', onChange: event => setTask(event.target.value), onKeyDown: event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void submit(); } } }), h('button', { className: 'cg-send', type: 'button', title: '发送到当前会话', 'aria-label': '发送到当前会话', disabled: !task.trim() || sending, onClick: () => void submit() }, '↑'))));
}

export const inject = ['slots', 'layout', 'sessions'];

export function apply(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.contextGraph = 'true';
    style.textContent = styles;
    document.head.append(style);
    return () => style.remove();
  }, 'context-graph: styles');

  ctx.inject(['slots', 'layout', 'sessions', 'conversation'], scope => {
    const close = () => scope.layout.closeDetails();
    window.addEventListener('context-graph:close', close);
    const dispose = scope.slots.inject('details', () => scope.slots.register({
      name: 'details',
      priority: -100,
      registrant: 'dsh-context-graph',
      inject: sessionId => {
        const projectPath = scope.sessions.list.getSnapshot().byId[sessionId]?.cwd || '';
        return {
          sessionId,
          projectPath,
          sendPrompt: async text => {
            const sessionScope = scope.sessions.scope(sessionId);
            const conversation = sessionScope?.get('conversation');
            if (!conversation) throw new Error('当前会话尚未准备好');
            await conversation.send(text);
          },
        };
      },
    }, GraphPanel));
    const disposeLauncher = scope.slots.inject('conversation.session.header.utilities', () => scope.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'context-graph',
      order: 90,
      registrant: 'dsh-context-graph',
      inject: () => ({ open: () => scope.layout.openDetails() }),
    }, GraphLauncher));
    const openPanel = () => { try { scope.layout.openDetails(); } catch { /* The next retry runs after the frame mounts. */ } };
    const firstOpen = setTimeout(openPanel, 0);
    const retryOpen = setTimeout(openPanel, 250);
    return () => {
      clearTimeout(firstOpen); clearTimeout(retryOpen);
      window.removeEventListener('context-graph:close', close);
      disposeLauncher(); dispose();
    };
  });

  const shortcut = event => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      try { ctx.layout.openDetails(); } catch { /* The layout is not mounted yet. */ }
    }
  };
  window.addEventListener('keydown', shortcut);
  ctx.effect(() => () => window.removeEventListener('keydown', shortcut), 'context-graph: panel shortcut');
}
