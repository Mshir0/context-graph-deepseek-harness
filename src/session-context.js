export const MIN_CONTEXT_TOKEN_BUDGET = 1000;
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 6000;
const MAX_IMPLEMENTATION_FILES = 5;
const MAX_SEMANTIC_DEPTH = 3;

function validIdList(value, name) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`${name} must be an array of node ids`);
  return [...new Set(value)];
}

export function resolveSessionContextSettings(state = {}, config = {}) {
  const tokenBudget = Number.isInteger(state.tokenBudget) && state.tokenBudget >= MIN_CONTEXT_TOKEN_BUDGET
    ? state.tokenBudget
    : Number.isInteger(config.tokenBudget) && config.tokenBudget >= MIN_CONTEXT_TOKEN_BUDGET
      ? config.tokenBudget
      : DEFAULT_CONTEXT_TOKEN_BUDGET;
  return {
    autoInject: typeof state.autoInject === 'boolean' ? state.autoInject : config.autoInject !== false,
    tokenBudget,
    reuseContext: typeof state.reuseContext === 'boolean' ? state.reuseContext : true,
    maxImplementationFiles: Number.isInteger(state.maxImplementationFiles) && state.maxImplementationFiles >= 1 && state.maxImplementationFiles <= MAX_IMPLEMENTATION_FILES ? state.maxImplementationFiles : 2,
    semanticDepth: Number.isInteger(state.semanticDepth) && state.semanticDepth >= 1 && state.semanticDepth <= MAX_SEMANTIC_DEPTH ? state.semanticDepth : 2,
    target: typeof state.target === 'string' ? state.target : null,
    include: Array.isArray(state.include) ? [...new Set(state.include.filter(item => typeof item === 'string'))] : [],
    exclude: Array.isArray(state.exclude) ? [...new Set(state.exclude.filter(item => typeof item === 'string'))] : [],
  };
}

export function updateSessionContextSettings(sessionState, sessionId, patch, config = {}) {
  const current = sessionState.get(sessionId);
  if (!current) throw new Error('Context Graph session is not active');
  const next = { ...current };
  if ('autoInject' in patch) {
    if (typeof patch.autoInject !== 'boolean') throw new Error('autoInject must be boolean');
    next.autoInject = patch.autoInject;
  }
  if ('tokenBudget' in patch) {
    if (!Number.isInteger(patch.tokenBudget) || patch.tokenBudget < MIN_CONTEXT_TOKEN_BUDGET) throw new Error(`tokenBudget must be an integer >= ${MIN_CONTEXT_TOKEN_BUDGET}`);
    next.tokenBudget = patch.tokenBudget;
  }
  if ('reuseContext' in patch) {
    if (typeof patch.reuseContext !== 'boolean') throw new Error('reuseContext must be boolean');
    next.reuseContext = patch.reuseContext;
  }
  if ('maxImplementationFiles' in patch) {
    if (!Number.isInteger(patch.maxImplementationFiles) || patch.maxImplementationFiles < 1 || patch.maxImplementationFiles > MAX_IMPLEMENTATION_FILES) throw new Error(`maxImplementationFiles must be an integer from 1 to ${MAX_IMPLEMENTATION_FILES}`);
    next.maxImplementationFiles = patch.maxImplementationFiles;
  }
  if ('semanticDepth' in patch) {
    if (!Number.isInteger(patch.semanticDepth) || patch.semanticDepth < 1 || patch.semanticDepth > MAX_SEMANTIC_DEPTH) throw new Error(`semanticDepth must be an integer from 1 to ${MAX_SEMANTIC_DEPTH}`);
    next.semanticDepth = patch.semanticDepth;
  }
  if ('target' in patch) {
    if (patch.target !== null && typeof patch.target !== 'string') throw new Error('target must be a node id or null');
    next.target = patch.target;
  }
  if ('include' in patch) next.include = validIdList(patch.include, 'include');
  if ('exclude' in patch) next.exclude = validIdList(patch.exclude, 'exclude');
  next.fingerprint = undefined;
  next.reusableFingerprint = undefined;
  sessionState.set(sessionId, next);
  return resolveSessionContextSettings(next, config);
}
