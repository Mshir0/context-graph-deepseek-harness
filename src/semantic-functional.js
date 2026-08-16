const IMPLEMENTATION_TYPES = new Set(['code_module', 'implementation_file', 'implementation_class', 'implementation_function', 'implementation_package', 'implementation_symbol']);
const HELPER_NAMES = new Set(['utils', 'util', 'helpers', 'helper', 'common', 'base', 'config', 'constants', 'types', 'models', 'test']);

function slug(value) { return String(value).replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'capability'; }
function titleCase(value) { return value.split(/[._/-]+/).filter(Boolean).map(part => /^[a-z]{2,5}$/i.test(part) ? part.toUpperCase() : `${part.charAt(0).toUpperCase()}${part.slice(1)}`).join(' '); }
function implementationNodes(graph) { return graph.nodes.filter(node => IMPLEMENTATION_TYPES.has(node.type)); }
function evidenceFor(node) { return { id: node.id, path: node.path || '', evidence: node.path || node.id }; }

function components(nodes, relationships) {
  const ids = new Set(nodes.map(node => node.id)); const adjacency = new Map(nodes.map(node => [node.id, new Set()]));
  for (const relation of relationships || []) if (ids.has(relation.from) && ids.has(relation.to) && relation.to !== '?') { adjacency.get(relation.from).add(relation.to); adjacency.get(relation.to).add(relation.from); }
  const result = []; const seen = new Set();
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const group = []; const queue = [node.id]; seen.add(node.id);
    while (queue.length) { const id = queue.shift(); group.push(id); for (const next of adjacency.get(id) || []) if (!seen.has(next)) { seen.add(next); queue.push(next); } }
    result.push(group);
  }
  return result;
}

function functionalTitle(group, nodeMap) {
  const names = group.map(id => nodeMap.get(id)?.path || id).map(item => item.split('/').at(-1).replace(/\.[^.]+$/, '')).filter(Boolean);
  const preferred = names.find(name => /^(asr|api|auth|router|routing|record|encoder|subtitle|speaker|capture)/i.test(name)) || names.find(name => !HELPER_NAMES.has(name.toLowerCase())) || names[0] || 'Capability';
  return titleCase(preferred);
}

export function inferFunctionalModules(graph, implementationFacts = { relationships: [] }) {
  const implementations = implementationNodes(graph); const nodeMap = new Map(implementations.map(node => [node.id, node]));
  const existing = new Set(graph.nodes.filter(node => node.type === 'functional').map(node => node.id));
  const proposals = []; const mappings = []; const functionalByImplementation = new Map();
  for (const group of components(implementations, implementationFacts.relationships || [])) {
    const title = functionalTitle(group, nodeMap); const id = `function.${slug(title)}`;
    const finalId = existing.has(id) ? id : id;
    if (!existing.has(finalId)) proposals.push({ id: finalId, type: 'functional', title, label: title, description: `${title} capability`, content: `${title} capability`, source: 'derived', priority: 'normal', status: 'active', mode: 'AUTO', provides: [], consumes: [], inputs: [], outputs: [], metadata: { layer: 'functional', inference: 'implementation-component' } });
    const implementation = group.map(item => evidenceFor(nodeMap.get(item)));
    mappings.push({ functional: finalId, implementation, evidence: implementation.map(item => item.evidence), confidence: group.length > 1 ? 0.78 : 0.58, created_by: 'auto', mode: 'AUTO' });
    for (const item of group) functionalByImplementation.set(item, finalId);
  }
  const edgeKeys = new Set(); const edges = [];
  for (const relation of implementationFacts.relationships || []) {
    const source = functionalByImplementation.get(relation.from); const target = functionalByImplementation.get(relation.to);
    if (!source || !target || source === target) continue;
    const key = `${source}\0${target}`; if (edgeKeys.has(key)) continue;
    edgeKeys.add(key); edges.push({ source, target, type: 'depends_on', scope: ['interface'], mode: 'AUTO', confidence: Math.min(0.8, relation.confidence || 0.7), metadata: { evidence: relation.evidence || [], derived_from: 'implementation_graph' } });
  }
  return { nodes: proposals, mappings, edges, warnings: implementations.length === 0 ? ['No implementation nodes available'] : [] };
}

export function applyFunctionalInference(graph, proposal) {
  const next = structuredClone(graph); const existingNodes = new Set(next.nodes.map(node => node.id));
  for (const node of proposal.nodes || []) if (!existingNodes.has(node.id)) { const index = next.nodes.length; next.nodes.push({ ...node, x: 80 + (index % 4) * 260, y: 80 + Math.floor(index / 4) * 180 }); existingNodes.add(node.id); }
  const mappingKeys = new Set((next.mappings || []).map(item => `${item.functional}\0${item.implementation.map(impl => impl.id).sort().join('\0')}`));
  next.mappings ||= [];
  for (const mapping of proposal.mappings || []) { const key = `${mapping.functional}\0${mapping.implementation.map(impl => impl.id).sort().join('\0')}`; if (!mappingKeys.has(key)) { next.mappings.push(mapping); mappingKeys.add(key); } }
  const edgeKeys = new Set(next.edges.map(edge => `${edge.source}\0${edge.target}\0${edge.type}`));
  for (const edge of proposal.edges || []) { const key = `${edge.source}\0${edge.target}\0${edge.type}`; if (!edgeKeys.has(key)) { next.edges.push(edge); edgeKeys.add(key); } }
  return next;
}

function taskTerms(task) { return String(task || '').toLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) || []; }
export function implementationForFunctional(graph, functionalId, task = '', max = 3) {
  const terms = taskTerms(task); const mapped = (graph.mappings || []).filter(item => item.functional === functionalId).flatMap(item => item.implementation || []);
  if (!mapped.length) return [];
  const score = item => { const text = `${item.id} ${item.path || ''} ${(item.capabilities || []).join(' ')}`.toLowerCase(); return terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0); };
  const items = [...new Map(mapped.map(item => [item.id, item])).values()].sort((left, right) => score(right) - score(left));
  const matching = items.filter(item => score(item) > 0);
  return (matching.length ? matching : items.slice(0, Math.min(2, max))).slice(0, max);
}

export function mergeFunctionalNodes(graph, sourceIds, mergedNode) {
  const next = structuredClone(graph); const source = new Set(sourceIds); const id = mergedNode.id;
  if (next.nodes.some(node => node.id === id) && !source.has(id)) throw new Error(`Functional node already exists: ${id}`);
  next.nodes = next.nodes.filter(node => !source.has(node.id)); next.nodes.push({ type: 'functional', source: 'user', mode: 'MANUAL', ...mergedNode });
  const implementations = [...new Map(next.mappings.filter(mapping => source.has(mapping.functional)).flatMap(mapping => mapping.implementation).map(item => [item.id, item])).values()];
  next.mappings = next.mappings.filter(mapping => !source.has(mapping.functional)); next.mappings.push({ functional: id, implementation: implementations, confidence: 1, created_by: 'user', mode: 'MANUAL' });
  next.edges = next.edges.map(edge => ({ ...edge, source: source.has(edge.source) ? id : edge.source, target: source.has(edge.target) ? id : edge.target })).filter(edge => edge.source !== edge.target);
  return next;
}

export function splitFunctionalNode(graph, sourceId, splits) {
  const next = structuredClone(graph); const source = next.nodes.find(node => node.id === sourceId && node.type === 'functional');
  if (!source) throw new Error(`Unknown functional node: ${sourceId}`);
  const originalMapping = next.mappings.find(mapping => mapping.functional === sourceId);
  const mapped = new Set((originalMapping?.implementation || []).map(item => item.id));
  for (const split of splits) for (const id of split.implementation || []) if (!mapped.has(id)) throw new Error(`Implementation ${id} is not mapped to ${sourceId}`);
  next.nodes = next.nodes.filter(node => node.id !== sourceId);
  next.mappings = next.mappings.filter(mapping => mapping.functional !== sourceId);
  for (const [index, split] of splits.entries()) {
    next.nodes.push({ ...source, ...split, type: 'functional', source: 'user', mode: 'MANUAL', x: (source.x || 80) + index * 230, y: source.y || 80 });
    next.mappings.push({ functional: split.id, implementation: (split.implementation || []).map(id => originalMapping.implementation.find(item => item.id === id)), confidence: 1, created_by: 'user', mode: 'MANUAL' });
  }
  const related = next.edges.filter(edge => edge.source === sourceId || edge.target === sourceId); next.edges = next.edges.filter(edge => edge.source !== sourceId && edge.target !== sourceId);
  for (const split of splits) for (const edge of related) next.edges.push({ ...edge, source: edge.source === sourceId ? split.id : edge.source, target: edge.target === sourceId ? split.id : edge.target, mode: 'MANUAL' });
  return next;
}
