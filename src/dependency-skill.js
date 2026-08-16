import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FACT_TYPES = new Set(['IMPORT', 'CALL', 'REFERENCE', 'INHERIT', 'IMPLEMENT', 'DATA_FLOW', 'EVENT', 'INTERFACE', 'OPTIONAL_DEPENDENCY']);
const edgeKey = (source, target) => `${source}\0${target}`;
const isInternal = item => item.to && item.to !== '?' && item.from !== item.to;

export async function analyzeDependencies(projectPath, { files = [] } = {}) {
  const executables = [process.env.DEPENDENCY_SKILL_PYTHON, ...(process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python'])].filter(Boolean);
  let failure;
  for (const executable of executables) try {
    const { stdout } = await execFileAsync(executable, [path.join(HERE, 'dependency_skill.py'), path.resolve(projectPath), ...files], { maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (error) { failure = error; }
  throw new Error(`Dependency Skill requires Python 3: ${failure?.message || 'unknown error'}`);
}
export const discoverModules = facts => facts.modules || [];
export function analyzeModule(facts, module) {
  const item = discoverModules(facts).find(candidate => candidate.id === module);
  return item && { module: item, relationships: (facts.relationships || []).filter(relation => relation.from === module || relation.to === module), interfaces: (facts.interfaces || []).filter(contract => contract.module === module) };
}
export const analyzeModuleDependencies = (facts, module) => (facts.relationships || []).filter(item => item.from === module);
export const findCallers = (facts, symbol) => (facts.relationships || []).filter(item => item.type === 'CALL' && (item.symbol === symbol || item.symbol?.endsWith(`.${symbol}`)));
export const findCallees = (facts, symbol) => (facts.relationships || []).filter(item => item.type === 'CALL' && (item.from_symbol === symbol || item.from_symbol?.endsWith(`.${symbol}`)));
export function findRelatedModules(facts, module) { const ids = new Set(); for (const item of facts.relationships || []) { if (item.from === module && isInternal(item)) ids.add(item.to); if (item.to === module) ids.add(item.from); } return [...ids].sort(); }
export const extractInterface = (facts, module) => (facts.interfaces || []).filter(item => item.module === module);
export function validateRelationship(facts, edge) { const relationships = (facts.relationships || []).filter(item => item.from === edge.source && item.to === edge.target && FACT_TYPES.has(item.type)); return { source: edge.source, target: edge.target, supported: relationships.length > 0, relationships, confidence: relationships.length ? Math.max(...relationships.map(item => item.confidence)) : 0 }; }

export function proposeContextEdges(facts, module = null) {
  const proposals = new Map();
  for (const item of facts.relationships || []) {
    if (module && item.from !== module) continue;
    if (!isInternal(item) || item.confidence < 0.6 || item.type === 'OPTIONAL_DEPENDENCY') continue;
    const directApi = ['CALL', 'INHERIT', 'INTERFACE'].includes(item.type); const key = edgeKey(item.from, item.to);
    const proposal = { from: item.from, to: item.to, proposed_type: directApi ? 'interface' : 'reference', recommended_scope: directApi ? ['interface', 'context'] : ['interface'], reason: `${item.from} ${item.type.toLowerCase()}s ${item.symbol || item.to}`, confidence: item.confidence, evidence: item.evidence };
    if (!proposals.has(key) || proposal.confidence > proposals.get(key).confidence) proposals.set(key, proposal);
  }
  return [...proposals.values()].sort((left, right) => edgeKey(left.from, left.to).localeCompare(edgeKey(right.from, right.to)));
}

const isManual = edge => {
  const mode = String(edge.mode || '').toUpperCase();
  const type = String(edge.type || '').toLowerCase();
  return mode === 'MANUAL' || mode === 'FORCE_INCLUDE' || mode === 'FORCE_EXCLUDE' || type === 'force_include' || type === 'force_exclude';
};
export function checkConsistency(facts, graph) {
  const graphEdges = graph?.edges || []; const present = new Set(graphEdges.map(edge => edgeKey(edge.source, edge.target)));
  const missing = proposeContextEdges(facts).filter(item => !present.has(edgeKey(item.from, item.to)));
  const stale = graphEdges.filter(edge => !isManual(edge) && ['dependency', 'reference', 'interface', 'data', 'optional'].includes(edge.type) && !validateRelationship(facts, edge).supported).map(edge => ({ source: edge.source, target: edge.target, recommendation: 'Review and possibly remove relationship.' }));
  const protectedEdges = graphEdges.filter(isManual).map(edge => ({ source: edge.source, target: edge.target, mode: edge.mode || edge.type }));
  const conflicts = graphEdges.filter(edge => edge.mode === 'FORCE_EXCLUDE' || edge.type === 'force_exclude').map(edge => ({ edge: { source: edge.source, target: edge.target }, facts: validateRelationship(facts, edge).relationships })).filter(item => item.facts.some(fact => ['CALL', 'INHERIT'].includes(fact.type) && fact.confidence >= 0.9));
  return { missing, stale, protected: protectedEdges, conflicts };
}
export function detectGraphChanges(previousFacts, nextFacts, { files = [] } = {}) {
  const key = item => `${item.from}\0${item.to}\0${item.type}\0${item.symbol || ''}`;
  const affected = new Set(files.map(file => file.replaceAll('\\', '/')));
  const inScope = item => affected.size === 0 || item.evidence?.some(evidence => affected.has(evidence.file));
  const before = new Map((previousFacts.relationships || []).filter(item => isInternal(item) && inScope(item)).map(item => [key(item), item])); const after = new Map((nextFacts.relationships || []).filter(item => isInternal(item) && inScope(item)).map(item => [key(item), item]));
  return { added: [...after].filter(([item]) => !before.has(item)).map(([, item]) => item), removed: [...before].filter(([item]) => !after.has(item)).map(([, item]) => item) };
}
