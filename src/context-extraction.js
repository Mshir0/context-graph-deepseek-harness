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

function semanticFields(text) {
  const codec = text.match(/h\.?26([45])/i);
  if (codec) return { subject: 'video', slot: 'codec', value: `h.26${codec[1]}` };
  const assignment = text.match(/^(.{1,48}?)(?:必须|应当|需要|采用|使用|改成|改为|替换为|must|should|use|replace(?:d)?(?: with)?|change(?:d)? to)\s*[:：]?\s*(.+)$/i);
  if (assignment) return { subject: topicKey(assignment[1]), slot: 'value', value: topicKey(assignment[2]) };
  const prohibition = text.match(/^(.{1,48}?)(?:不能|不得|禁止|must not|should not|without)\s*[:：]?\s*(.+)$/i);
  if (prohibition) return { subject: topicKey(prohibition[1]), slot: 'prohibition', value: topicKey(prohibition[2]) };
  return { subject: topicKey(text), slot: '', value: '' };
}

function nodeSemanticFields(node) {
  return {
    subject: node.subject || node.metadata?.subject || semanticFields(node.content || '').subject,
    slot: node.slot || node.metadata?.slot || semanticFields(node.content || '').slot,
    value: node.value || node.metadata?.value || semanticFields(node.content || '').value,
  };
}

function findSuperseded(node, graph, text) {
  if (!/(改成|改为|替换为|instead|replace|change to)/i.test(text)) return null;
  const key = topicKey(text);
  const fields = nodeSemanticFields(node);
  const candidates = (graph?.nodes || []).filter(item => item.type === node.type && item.status !== 'superseded' && item.content && item.id !== node.id);
  const matches = candidates.filter(item => {
    const previous = nodeSemanticFields(item);
    return fields.subject && fields.slot && previous.subject === fields.subject && previous.slot === fields.slot
      || (key.includes('video-codec') && topicKey(item.content).includes('video-codec'))
      || (key && topicKey(item.content) === key);
  });
  return matches.length === 1 ? matches[0] : matches.length > 1 ? matches : null;
}

export function extractContext(text, { source = 'user', conversationId = 'conversation-current', messageId, graph = { nodes: [] }, createdAt = new Date().toISOString() } = {}) {
  const value = String(text || '').trim();
  if (!value) return { nodes: [], edges: [], confidence: 0, warnings: ['Empty input'] };
  const rawMessageId = messageId || stableId(source === 'assistant' ? 'assistant-message' : 'user-message', `${conversationId}\0${value}`);
  const conversation = { id: conversationId, type: 'conversation', title: conversationId, content: '', source: 'system', created_by: 'plugin', confidence: 1, derived_from: [], last_verified: createdAt, priority: 'low', status: 'archived', created_at: createdAt, updated_at: createdAt, metadata: { raw: true, layer: 'raw', subtype: 'conversation' } };
  const rawMessage = { id: rawMessageId, type: 'conversation', title: source === 'assistant' ? 'Assistant message' : 'User message', content: value, source, created_by: source === 'assistant' ? 'ai' : 'user', confidence: 1, derived_from: [conversationId], last_verified: createdAt, priority: 'low', status: 'archived', created_at: createdAt, updated_at: createdAt, metadata: { raw: true, layer: 'raw', subtype: source === 'assistant' ? 'assistant_message' : 'user_message', conversation_id: conversationId } };
  const nodes = [conversation, rawMessage];
  const edges = [{ source: rawMessageId, target: conversationId, type: 'contains', scope: [], mode: 'AUTO', confidence: 1 }];
  const warnings = [];
  for (const [index, clause] of clauses(value).entries()) {
    const classification = classify(clause, source);
    if (!classification || !STRUCTURED_TYPES.includes(classification.type)) { warnings.push(`Unclassified: ${clause}`); continue; }
    const id = stableId(classification.type, `${rawMessageId}\0${index}\0${clause}`);
    const fields = semanticFields(clause);
    const node = { id, type: classification.type, title: titleOf(clause), label: titleOf(clause), content: clause, source, created_by: source === 'assistant' ? 'ai' : 'user', confidence: classification.confidence, derived_from: [rawMessageId], last_verified: createdAt, subject: fields.subject, slot: fields.slot, value: fields.value, priority: /(必须|不得|不能|must)/i.test(clause) ? 'high' : 'normal', status: 'active', created_at: createdAt, updated_at: createdAt, metadata: { layer: 'structured', confidence: classification.confidence, source_message: rawMessageId, ...fields } };
    const previous = findSuperseded(node, graph, clause);
    if (Array.isArray(previous)) warnings.push(`Ambiguous supersedes target for: ${clause}`);
    else if (previous) { node.metadata.supersedes = previous.id; edges.push({ source: id, target: previous.id, type: 'supersedes', scope: ['content'], mode: 'AUTO', confidence: classification.confidence }); }
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
  const resolvedPairs = new Set(graph.edges.filter(edge => ['supersedes', 'conflicts_with'].includes(edge.type)).flatMap(edge => [`${edge.source}\0${edge.target}`, `${edge.target}\0${edge.source}`]));
  const conflicts = [];
  for (let left = 0; left < active.length; left += 1) for (let right = left + 1; right < active.length; right += 1) {
    const a = active[left]; const b = active[right]; if (a.type !== b.type || resolvedPairs.has(`${a.id}\0${b.id}`)) continue;
    const aFields = nodeSemanticFields(a); const bFields = nodeSemanticFields(b);
    const codecConflict = /h\.?264/i.test(a.content) && /h\.?265/i.test(b.content) || /h\.?265/i.test(a.content) && /h\.?264/i.test(b.content);
    const slotConflict = aFields.subject && aFields.slot && aFields.subject === bFields.subject && aFields.slot === bFields.slot && aFields.value && bFields.value && aFields.value !== bFields.value;
    if (codecConflict || slotConflict) conflicts.push({ nodes: [a.id, b.id], type: 'potential_conflict', reason: codecConflict ? 'Mutually exclusive codec requirements' : `Conflicting values for ${aFields.subject}.${aFields.slot}`, recommendation: 'Confirm supersedes or conflicts_with.', proposal: { source: b.id, target: a.id, type: 'conflicts_with', scope: ['content'], mode: 'MANUAL' } });
  }
  return conflicts;
}
