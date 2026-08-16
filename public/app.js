const $ = (selector) => document.querySelector(selector);
const NS = 'http://www.w3.org/2000/svg';
const scopes = ['code', 'context', 'interface', 'state', 'decisions', 'history'];
const relationTypes = ['dependency', 'reference', 'interface', 'data', 'optional', 'force_include', 'force_exclude'];
const state = { graph: null, selected: null, zoom: 1, pan: { x: 0, y: 0 }, drag: null, suggestions: [] };

function svg(tag, attrs = {}, text = '') {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  if (text) element.textContent = text;
  return element;
}

async function request(url, options = {}) {
  const response = await fetch(url, { headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function setStatus(text, error = false) {
  $('#status').textContent = text;
  $('#status').style.color = error ? '#ef6464' : '';
}

function project() { return $('#project').value.trim(); }
function screenToGraph(event) {
  const rect = $('#canvas').getBoundingClientRect();
  return { x: (event.clientX - rect.left - state.pan.x) / state.zoom, y: (event.clientY - rect.top - state.pan.y) / state.zoom };
}

function edgePath(source, target) {
  const x1 = source.x + 210, y1 = source.y + 63, x2 = target.x, y2 = target.y + 63;
  const bend = Math.max(70, Math.abs(x2 - x1) * .45);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function render() {
  if (!state.graph) return;
  $('#viewport').setAttribute('transform', `translate(${state.pan.x} ${state.pan.y}) scale(${state.zoom})`);
  const nodes = new Map(state.graph.nodes.map((node) => [node.id, node]));
  $('#edges').replaceChildren();
  state.graph.edges.forEach((edge, index) => {
    const source = nodes.get(edge.source), target = nodes.get(edge.target);
    if (!source || !target) return;
    const d = edgePath(source, target);
    const group = svg('g');
    const hit = svg('path', { d, class: 'edge-hit' });
    const line = svg('path', { d, class: `edge ${edge.type} ${state.selected?.kind === 'edge' && state.selected.index === index ? 'selected' : ''}` });
    for (const item of [hit, line]) item.addEventListener('pointerdown', (event) => { event.stopPropagation(); select({ kind: 'edge', index }); });
    group.append(hit, line); $('#edges').append(group);
  });
  $('#nodes').replaceChildren();
  for (const node of state.graph.nodes) {
    const group = svg('g', { transform: `translate(${node.x || 0} ${node.y || 0})`, class: `node ${node.mode === 'FORCE_INCLUDE' ? 'force-include' : node.mode === 'FORCE_EXCLUDE' ? 'force-exclude' : ''} ${state.selected?.kind === 'node' && state.selected.id === node.id ? 'selected' : ''}` });
    group.dataset.id = node.id;
    group.append(svg('rect', { width: 210, height: 126, rx: 5 }), svg('rect', { class: 'header', width: 210, height: 34, rx: 5 }), svg('text', { x: 14, y: 22 }, node.label || node.id), svg('text', { class: 'subtitle', x: 14, y: 53 }, node.path || 'No source path'), svg('text', { class: 'subtitle', x: 14, y: 78 }, `MODE  ${node.mode || 'AUTO'}`), svg('text', { class: 'subtitle', x: 14, y: 103 }, `SCOPE  ${(node.scope || ['interface', 'state']).join(' · ')}`), svg('circle', { class: 'port', cx: 210, cy: 63, r: 6 }));
    group.addEventListener('pointerdown', (event) => {
      event.stopPropagation(); select({ kind: 'node', id: node.id });
      const point = screenToGraph(event); state.drag = { kind: 'node', id: node.id, dx: point.x - node.x, dy: point.y - node.y };
      try { group.setPointerCapture(event.pointerId); } catch { /* Synthetic pointer events cannot be captured. */ }
    });
    $('#nodes').append(group);
  }
  populateTargets();
}

function select(value) { state.selected = value; render(); renderInspector(); }

function checkboxes(container, selected = []) {
  container.replaceChildren(...scopes.map((scope) => {
    const label = document.createElement('label'); const input = document.createElement('input');
    input.type = 'checkbox'; input.value = scope; input.checked = selected.includes(scope); label.append(input, scope); return label;
  }));
}
function checked(container) { return [...container.querySelectorAll('input:checked')].map((input) => input.value); }

function renderInspector() {
  const nodeForm = $('#node-form'), edgeForm = $('#edge-form');
  $('#empty-selection').hidden = Boolean(state.selected); nodeForm.hidden = true; edgeForm.hidden = true;
  if (state.selected?.kind === 'node') {
    const node = state.graph.nodes.find((item) => item.id === state.selected.id); if (!node) return select(null);
    nodeForm.hidden = false; $('#node-title').textContent = node.label || node.id; $('#node-id').value = node.id; $('#node-path').value = node.path || ''; $('#node-mode').value = node.mode || 'AUTO'; checkboxes($('#node-scopes'), node.scope || ['interface', 'state']);
  } else if (state.selected?.kind === 'edge') {
    const edge = state.graph.edges[state.selected.index]; if (!edge) return select(null);
    edgeForm.hidden = false; $('#edge-title').textContent = `${edge.source} → ${edge.target}`; $('#edge-type').value = edge.type; $('#edge-mode').value = edge.mode || 'AUTO'; checkboxes($('#edge-scopes'), edge.scope || []);
  }
}

function populateTargets() {
  for (const selector of ['#target', '#connect-target']) {
    const select = $(selector), previous = select.value;
    select.replaceChildren(...state.graph.nodes.map((node) => new Option(node.label || node.id, node.id)));
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }
}

function autoLayout() {
  const incoming = new Map(state.graph.nodes.map((node) => [node.id, 0]));
  for (const edge of state.graph.edges) incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
  const queue = state.graph.nodes.filter((node) => !incoming.get(node.id)).map((node) => node.id); const levels = new Map(queue.map((id) => [id, 0]));
  while (queue.length) { const id = queue.shift(); for (const edge of state.graph.edges.filter((item) => item.source === id)) if (!levels.has(edge.target)) { levels.set(edge.target, levels.get(id) + 1); queue.push(edge.target); } }
  state.graph.nodes.forEach((node) => { if (!levels.has(node.id)) levels.set(node.id, 0); });
  const rows = new Map(); for (const node of state.graph.nodes) { const level = levels.get(node.id); const row = rows.get(level) || 0; node.x = 80 + level * 310; node.y = 70 + row * 180; rows.set(level, row + 1); } render();
}

function renderSuggestions() {
  const root = $('#suggestions');
  if (!state.suggestions.length) { root.innerHTML = '<div class="empty"><strong>No pending changes</strong><span>Scan code to compare both graphs.</span></div>'; return; }
  root.replaceChildren(...state.suggestions.map((suggestion, index) => {
    const box = document.createElement('div'); box.className = 'suggestion';
    box.innerHTML = `<strong>${suggestion.kind === 'missing' ? 'New dependency detected' : 'Possibly stale context edge'}</strong><p>${escapeHtml(suggestion.source)} → ${escapeHtml(suggestion.target)}<br>${escapeHtml(suggestion.reason)}</p>`;
    const accept = document.createElement('button'); accept.textContent = suggestion.kind === 'missing' ? 'Accept' : 'Remove'; accept.addEventListener('click', () => {
      if (suggestion.kind === 'missing') state.graph.edges.push(suggestion.proposal); else state.graph.edges = state.graph.edges.filter((edge) => !(edge.source === suggestion.source && edge.target === suggestion.target));
      state.suggestions.splice(index, 1); render(); renderSuggestions();
    });
    const reject = document.createElement('button'); reject.textContent = 'Dismiss'; reject.className = 'secondary'; reject.style.marginLeft = '6px'; reject.addEventListener('click', () => { state.suggestions.splice(index, 1); renderSuggestions(); });
    box.append(accept, reject); return box;
  }));
}

function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function showPreview(result) {
  const percent = Math.round(result.estimatedTokens / result.tokenBudget * 100);
  $('#preview-result').innerHTML = `<div><strong>${result.estimatedTokens.toLocaleString()}</strong> / ${result.tokenBudget.toLocaleString()} estimated tokens</div><div class="meter ${result.overBudget ? 'over' : ''}"><i style="width:${Math.min(percent, 100)}%"></i></div><div class="eyebrow">Included</div>${result.included.map((item) => `<div class="context-item"><span>✓ ${escapeHtml(item.label)}</span><span>${item.tokens}</span></div>`).join('')}<div class="eyebrow" style="margin-top:18px">Excluded</div>${result.excluded.map((item) => `<div class="context-item excluded"><span>× ${escapeHtml(item.module || '')} ${escapeHtml(item.scope || '')}</span><span>${escapeHtml(item.reason)}</span></div>`).join('') || '<div class="context-item excluded">None</div>'}`;
}

async function load() {
  try { setStatus('Loading…'); const config = await request('/api/config'); $('#project').value = config.projectPath; state.graph = await request(`/api/graph?project=${encodeURIComponent(project())}`); render(); renderSuggestions(); setStatus('Ready'); }
  catch (error) { setStatus(error.message, true); }
}

for (const type of relationTypes) { $('#edge-type').append(new Option(type, type)); $('#connect-type').append(new Option(type, type)); }
$('.tabs').addEventListener('click', (event) => { if (!event.target.dataset.tab) return; document.querySelectorAll('.tab,.panel').forEach((item) => item.classList.remove('active')); event.target.classList.add('active'); $(`#${event.target.dataset.tab}`).classList.add('active'); });
$('#canvas').addEventListener('pointerdown', (event) => { select(null); state.drag = { kind: 'pan', startX: event.clientX, startY: event.clientY, x: state.pan.x, y: state.pan.y }; $('#canvas').setPointerCapture(event.pointerId); });
$('#canvas').addEventListener('pointermove', (event) => {
  if (!state.drag) return;
  if (state.drag.kind === 'pan') { state.pan.x = state.drag.x + event.clientX - state.drag.startX; state.pan.y = state.drag.y + event.clientY - state.drag.startY; }
  else { const node = state.graph.nodes.find((item) => item.id === state.drag.id), point = screenToGraph(event); node.x = point.x - state.drag.dx; node.y = point.y - state.drag.dy; }
  render();
});
$('#canvas').addEventListener('pointerup', () => { state.drag = null; });
$('#canvas').addEventListener('wheel', (event) => { event.preventDefault(); state.zoom = Math.min(2, Math.max(.35, state.zoom * (event.deltaY > 0 ? .9 : 1.1))); render(); }, { passive: false });
$('#zoom-in').onclick = () => { state.zoom = Math.min(2, state.zoom * 1.15); render(); }; $('#zoom-out').onclick = () => { state.zoom = Math.max(.35, state.zoom / 1.15); render(); }; $('#fit').onclick = () => { state.zoom = 1; state.pan = { x: 0, y: 0 }; render(); }; $('#layout').onclick = autoLayout;
$('#node-path').onchange = (event) => { state.graph.nodes.find((node) => node.id === state.selected.id).path = event.target.value; render(); }; $('#node-mode').onchange = (event) => { state.graph.nodes.find((node) => node.id === state.selected.id).mode = event.target.value; render(); }; $('#node-scopes').onchange = () => { state.graph.nodes.find((node) => node.id === state.selected.id).scope = checked($('#node-scopes')); render(); };
$('#edge-type').onchange = (event) => { state.graph.edges[state.selected.index].type = event.target.value; render(); }; $('#edge-mode').onchange = (event) => { state.graph.edges[state.selected.index].mode = event.target.value; render(); }; $('#edge-scopes').onchange = () => { state.graph.edges[state.selected.index].scope = checked($('#edge-scopes')); render(); };
$('#delete-node').onclick = () => { const id = state.selected.id; state.graph.nodes = state.graph.nodes.filter((node) => node.id !== id); state.graph.edges = state.graph.edges.filter((edge) => edge.source !== id && edge.target !== id); select(null); }; $('#delete-edge').onclick = () => { state.graph.edges.splice(state.selected.index, 1); select(null); };
$('#add-node').onclick = () => { const id = prompt('Module id'); if (!id || state.graph.nodes.some((node) => node.id === id)) return; state.graph.nodes.push({ id, label: id, path: '', mode: 'AUTO', scope: ['interface', 'state'], x: 120, y: 120 }); select({ kind: 'node', id }); };
$('#connect').onclick = () => { $('#connect-target').value = state.graph.nodes.find((node) => node.id !== state.selected.id)?.id || ''; $('#connect-dialog').showModal(); }; $('#confirm-connect').onclick = (event) => { event.preventDefault(); const target = $('#connect-target').value, source = state.selected.id; if (target && target !== source) state.graph.edges.push({ source, target, type: $('#connect-type').value, scope: $('#connect-type').value === 'interface' ? ['interface'] : ['interface', 'state'], mode: 'AUTO' }); $('#connect-dialog').close(); render(); };
$('#scan').onclick = async () => { try { setStatus('Scanning…'); const result = await request('/api/scan', { method: 'POST', body: JSON.stringify({ projectPath: project() }) }); state.graph = result.graph; state.suggestions = result.suggestions; render(); renderSuggestions(); setStatus(`${result.codeGraph.modules.length} modules`); } catch (error) { setStatus(error.message, true); } };
$('#save').onclick = async () => { try { setStatus('Saving…'); state.graph = await request('/api/graph', { method: 'POST', body: JSON.stringify({ projectPath: project(), graph: state.graph }) }); setStatus('Saved'); } catch (error) { setStatus(error.message, true); } };
$('#compile').onclick = async () => { try { const result = await request('/api/compile', { method: 'POST', body: JSON.stringify({ projectPath: project(), graph: state.graph, target: $('#target').value, task: $('#task').value, tokenBudget: Number($('#budget').value) }) }); showPreview(result); } catch (error) { $('#preview-result').textContent = error.message; } };
$('#project').addEventListener('change', async () => { try { state.graph = await request(`/api/graph?project=${encodeURIComponent(project())}`); state.selected = null; render(); renderInspector(); } catch (error) { setStatus(error.message, true); } });
load();
