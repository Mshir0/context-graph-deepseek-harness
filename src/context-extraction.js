import { createHash } from 'node:crypto';

const STRUCTURED_TYPES = ['requirement', 'task', 'constraint', 'decision', 'issue', 'note'];

function stableId(prefix, value) { return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`; }
function titleOf(text) { const clean = text.trim().replace(/^[：:，,\s]+|[。.!！?？\s]+$/g, ''); return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean; }
function clauses(text) { return text.split(/[。！？!?]\s*|\n+/).flatMap(sentence => sentence.split(/(?:，|,)?(?:并且|而且|同时)|[；;]/)).map(item => item.trim()).filter(Boolean); }

function classify(text, source) {
  if (/(不能|不得|不可|禁止|不允许|不能够|must not|should not|without)/i.test(text)) return { type: 'constraint', confidence: 0.96 };
  if (source === 'assistant' && /(决定|采用|应该|应保持|保持独立|方案是|recommend|should|decision)/i.test(text)) return { type: 'decision', confidence: 0.9 };
  if (/(我要|我们要).*(增加|添加).*(支持|能力|功能)/i.test(text)) return { type: 'requirement', confidence: 0.9 };
  if (/(修复|修改|实现|增加|添加|编写|重构|测试|排查|fix|implement|add|refactor|test)/i.test(text)) return { type: 'task', confidence: 0.88 };
  if (/(必须|需要|应当|要求|支持|使用|改成|改为|替换为|must|need|require|support|use|replace|change to)/i.test(text)) return { type: 'requirement', confidence: 0.9 };
  if (/(错误|失败|异常|bug|issue|failure|error)/i.test(text)) return { type: 'issue', confidence: 0.76 };
  return null;
}

function topicKey(text) {
  return text.toLowerCase().replace(/h\.?26[45]/g, 'video-codec').replace(/(改成|改为|替换为|必须|需要|应当|使用|采用|should|must|use)/g, '').replace(/[^a-z0-9\u4e00-\u9fff-]+/g, ' ').trim();
}

function findSuperseded(node, graph, text) {
  if (!/(改成|改为|替换为|instead|replace|change to)/i.test(text)) return null;
  const key = topicKey(text);
  const candidates = (graph?.nodes || []).filter(item => item.type === node.type && item.status !== 'superseded' && item.content && item.id !== node.id);
  return candidates.find(item => (key.includes('video-codec') && topicKey(item.content).includes('video-codec')) || (key && topicKey(item.content) === key)) || null;
}

export function extractContext(text, { source = 'user', conversationId = 'conversation-current', messageId, graph = { nodes: [] }, createdAt = new Date().toISOString() } = {}) {
  const value = String(text || '').trim();
  if (!value) return { nodes: [], edges: [], confidence: 0, warnings: ['Empty input'] };
  const rawMessageId = messageId || stableId(source === 'assistant' ? 'assistant-message' : 'user-message', `${conversationId}\0${value}`);
  const conversation = { id: conversationId, type: 'conversation', title: conversationId, content: '', source: 'system', priority: 'low', status: 'archived', created_at: createdAt, updated_at: createdAt, metadata: { raw: true, layer: 'raw', subtype: 'conversation' } };
  const rawMessage = { id: rawMessageId, type: 'conversation', title: source === 'assistant' ? 'Assistant message' : 'User message', content: value, source, priority: 'low', status: 'archived', created_at: createdAt, updated_at: createdAt, metadata: { raw: true, layer: 'raw', subtype: source === 'assistant' ? 'assistant_message' : 'user_message', conversation_id: conversationId } };
  const nodes = [conversation, rawMessage];
  const edges = [{ source: rawMessageId, target: conversationId, type: 'contains', scope: [], mode: 'AUTO', confidence: 1 }];
  const warnings = [];
  for (const [index, clause] of clauses(value).entries()) {
    const classification = classify(clause, source);
    if (!classification || !STRUCTURED_TYPES.includes(classification.type)) { warnings.push(`Unclassified: ${clause}`); continue; }
    const id = stableId(classification.type, `${rawMessageId}\0${index}\0${clause}`);
    const node = { id, type: classification.type, title: titleOf(clause), label: titleOf(clause), content: clause, source, priority: /(必须|不得|不能|must)/i.test(clause) ? 'high' : 'normal', status: 'active', created_at: createdAt, updated_at: createdAt, metadata: { layer: 'structured', confidence: classification.confidence, source_message: rawMessageId } };
    const previous = findSuperseded(node, graph, value);
    if (previous) { node.metadata.supersedes = previous.id; edges.push({ source: id, target: previous.id, type: 'supersedes', scope: ['content'], mode: 'AUTO', confidence: classification.confidence }); }
    nodes.push(node);
    edges.push({ source: id, target: rawMessageId, type: 'derived_from', scope: ['content'], mode: 'AUTO', confidence: classification.confidence });
  }
  return { nodes, edges, confidence: nodes.length > 2 ? Math.min(...nodes.slice(2).map(node => node.metadata.confidence)) : 0, warnings };
}

export function applyExtraction(graph, extraction) {
  const next = structuredClone(graph); const existing = new Set(next.nodes.map(node => node.id));
  for (const node of extraction.nodes) if (!existing.has(node.id)) { const index = next.nodes.length; next.nodes.push({ ...node, x: 80 + (index % 4) * 260, y: 80 + Math.floor(index / 4) * 180 }); existing.add(node.id); }
  const edgeKeys = new Set(next.edges.map(edge => `${edge.source}\0${edge.target}\0${edge.type}`));
  for (const edge of extraction.edges) { const key = `${edge.source}\0${edge.target}\0${edge.type}`; if (!edgeKeys.has(key)) { next.edges.push(edge); edgeKeys.add(key); } }
  for (const node of extraction.nodes) if (node.metadata?.supersedes) next.nodes = next.nodes.map(item => item.id === node.metadata.supersedes ? { ...item, status: 'superseded', updated_at: node.updated_at } : item);
  return next;
}

export function detectContextConflicts(graph) {
  const active = graph.nodes.filter(node => ['requirement', 'constraint', 'decision'].includes(node.type) && node.status === 'active' && node.content);
  const superseded = new Set(graph.edges.filter(edge => edge.type === 'supersedes').flatMap(edge => [edge.source, edge.target]));
  const conflicts = [];
  for (let left = 0; left < active.length; left += 1) for (let right = left + 1; right < active.length; right += 1) {
    const a = active[left]; const b = active[right]; if (a.type !== b.type || superseded.has(a.id) || superseded.has(b.id)) continue;
    const codecConflict = /h\.?264/i.test(a.content) && /h\.?265/i.test(b.content) || /h\.?265/i.test(a.content) && /h\.?264/i.test(b.content);
    if (codecConflict) conflicts.push({ nodes: [a.id, b.id], type: 'potential_conflict', reason: 'Mutually exclusive codec requirements', recommendation: 'Confirm supersedes or conflicts_with.' });
  }
  return conflicts;
}
