import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { analyzeProject } from './core.js';
import { analyzeDependencies } from './dependency-skill.js';
import {
  hashImplementationFile,
  IMPLEMENTATION_INDEX_VERSION,
  loadFactsCache,
  updateFactsCache,
} from './implementation-index.js';

const SOURCE_EXTENSIONS = new Set(['.py', '.c', '.cc', '.cpp', '.cxx']);
const IGNORED_DIRECTORIES = new Set(['.git', '.context', 'node_modules', '.venv', 'venv', '__pycache__']);

async function implementationFiles(projectPath) {
  const root = path.resolve(projectPath);
  const files = [];
  async function walk(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) await walk(path.join(directory, entry.name));
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(path.relative(root, path.join(directory, entry.name)).replaceAll(path.sep, '/'));
    }
  }
  await walk(root);
  return files.sort();
}

async function compareWorkspace(projectPath, previous) {
  const files = await implementationFiles(projectPath);
  const before = previous?.files || {};
  const changed = [];
  const unchanged = [];
  for (const file of files) {
    const fingerprint = await hashImplementationFile(projectPath, file);
    if (before[file]?.hash === fingerprint.hash) unchanged.push(file);
    else changed.push(file);
  }
  const current = new Set(files);
  const deleted = Object.keys(before).filter(file => !current.has(file)).sort();
  return { files, changed, unchanged, deleted };
}

function mergeFacts(codeFacts, dependencyFacts) {
  const dependencies = new Map((dependencyFacts.modules || []).map(module => [module.id, module]));
  const modules = (codeFacts.modules || []).map(module => {
    const dependency = dependencies.get(module.id);
    return dependency ? { ...module, symbols: dependency.symbols || module.symbols || [] } : module;
  });
  for (const module of dependencyFacts.modules || []) if (!modules.some(item => item.id === module.id)) modules.push(module);
  return {
    ...codeFacts,
    modules,
    relationships: dependencyFacts.relationships || [],
    interfaces: dependencyFacts.interfaces || [],
    analyzed_files: dependencyFacts.analyzed_files || modules.map(module => module.path).filter(Boolean),
    errors: [...(codeFacts.errors || []), ...(dependencyFacts.errors || [])],
  };
}

async function analyzeFacts(projectPath, files = []) {
  const codeFacts = await analyzeProject(projectPath, { files });
  let dependencyFacts;
  try {
    dependencyFacts = await analyzeDependencies(projectPath, { files });
  } catch (error) {
    dependencyFacts = {
      version: 1,
      modules: codeFacts.modules || [],
      relationships: [],
      interfaces: [],
      analyzed_files: (codeFacts.modules || []).map(module => module.path).filter(Boolean),
      errors: [{ error: `Dependency facts unavailable: ${error.message || String(error)}` }],
    };
  }
  return { facts: mergeFacts(codeFacts, dependencyFacts), dependencyFacts };
}

export async function analyzeContextProject(projectPath, { persistCache = true } = {}) {
  const root = path.resolve(projectPath);
  const previous = await loadFactsCache(root);
  const reusable = previous?.analyzer_version === IMPLEMENTATION_INDEX_VERSION
    && previous?.project_path === root
    && previous?.facts && typeof previous.facts === 'object';
  const workspace = reusable ? await compareWorkspace(root, previous) : null;

  if (reusable && workspace.changed.length === 0 && workspace.deleted.length === 0) {
    return {
      facts: previous.facts,
      dependencyFacts: previous.facts,
      cache: previous,
      previousCache: previous,
      invalidation: { changed: [], deleted: [], unchanged: workspace.unchanged, invalidated: { files: [], modules: [], symbols: [], interfaces: [] } },
      cachePersisted: false,
      analysisMode: 'cache',
      analyzedFiles: [],
    };
  }

  // Adding or deleting a module can change package-root aliases for otherwise
  // untouched imports, so structural changes deliberately take the full path.
  const structuralChange = reusable && (workspace.deleted.length > 0 || workspace.files.length !== Object.keys(previous.files || {}).length);
  const incrementalFiles = reusable && !structuralChange ? workspace.changed : [];
  const analyzed = await analyzeFacts(root, incrementalFiles);
  const cache = await updateFactsCache(root, analyzed.facts, {
    incremental: incrementalFiles.length > 0,
    analyzedFiles: incrementalFiles,
    persist: persistCache,
  });
  const facts = cache.cache.facts;
  return {
    facts,
    dependencyFacts: facts,
    cache: cache.cache,
    previousCache: cache.previous,
    invalidation: cache.invalidation,
    cachePersisted: persistCache,
    analysisMode: incrementalFiles.length ? 'incremental' : 'full',
    analyzedFiles: incrementalFiles.length ? incrementalFiles : facts.analyzed_files || facts.modules?.map(module => module.path).filter(Boolean) || [],
  };
}

function affectedByMapping(mapping, invalidated) {
  const modules = new Set(invalidated.modules || []);
  const symbols = new Set(invalidated.symbols || []);
  const files = new Set(invalidated.files || []);
  return (mapping.implementation || []).some(item => {
    const implementation = typeof item === 'string' ? { id: item } : item;
    return modules.has(implementation.id) || symbols.has(implementation.id) || files.has(implementation.path);
  });
}

export function applyContextInvalidation(graph, invalidation = {}) {
  const invalidated = invalidation.invalidated || invalidation;
  const modules = new Set(invalidated.modules || []);
  const symbols = new Set(invalidated.symbols || []);
  const interfaces = new Set(invalidated.interfaces || []);
  const changed = new Set([...(invalidated.files || []), ...(invalidation.changed || []), ...(invalidation.deleted || [])]);
  if (modules.size === 0 && symbols.size === 0 && interfaces.size === 0 && changed.size === 0) return graph;
  const next = structuredClone(graph);
  const now = new Date().toISOString();
  const affectedFunctions = new Set();

  next.mappings = (next.mappings || []).map(mapping => {
    if (!affectedByMapping(mapping, { modules: [...modules], symbols: [...symbols], files: [...changed] })) return mapping;
    affectedFunctions.add(mapping.functional);
    return {
      ...mapping,
      metadata: {
        ...(mapping.metadata || {}),
        status: mapping.mode === 'MANUAL' ? 'review_required' : 'stale',
        invalidated_by: [...changed],
        invalidated_at: now,
      },
    };
  });

  next.nodes = next.nodes.map(node => {
    const module = node.metadata?.module;
    const qualified = node.metadata?.qualified_id || node.id;
    const interfaceAffected = node.type === 'interface' && (modules.has(module) || interfaces.has(qualified));
    const functionalAffected = node.type === 'functional' && affectedFunctions.has(node.id);
    if (!interfaceAffected && !functionalAffected) return node;
    const manual = node.mode === 'MANUAL';
    return {
      ...node,
      status: manual ? node.status : 'stale',
      updated_at: now,
      metadata: {
        ...(node.metadata || {}),
        invalidation_status: manual ? 'review_required' : 'stale',
        invalidated_by: [...changed],
        invalidated_at: now,
      },
    };
  });
  next.cache = { ...(next.cache || {}), invalidated: [...new Set([...(next.cache?.invalidated || []), ...modules, ...symbols, ...interfaces])], updated_at: now };
  return next;
}
