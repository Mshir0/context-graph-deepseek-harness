export function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user' || ['plugin', 'tool'].includes(message?.source?.kind)) continue;
    const content = Array.isArray(message.content) ? message.content : [];
    return content.filter(block => block?.type === 'text').map(block => block.text || '').join('\n').trim();
  }
  return '';
}

const EXCLUSION_MARKERS = [
  /(?:不要|别|禁止)(?:再)?(?:自动)?(?:加载|包含|注入|读取|选择|使用|参考|带上|携带)\s*/giu,
  /(?:无需|不需要)(?:再)?(?:加载|包含|注入|读取|选择|使用|参考|带上|携带)\s*/giu,
  /排除\s*/giu,
  /\b(?:do not|don't|never|must not|should not)\s+(?:load|include|inject|read|select|use|reference|send)\s+/giu,
  /\b(?:exclude|omit)\s+/giu,
];

function nodeAliases(nodes) {
  const aliases = new Map();
  for (const node of nodes) for (const value of [node.id, node.title, node.label]) {
    const alias = String(value || '').trim().toLowerCase();
    if (!alias) continue;
    const ids = aliases.get(alias) || new Map();
    const implementation = node.type === 'code_module' || String(node.type || '').startsWith('implementation_');
    const priority = node.type === 'functional' ? 3 : implementation ? 1 : 2;
    ids.set(node.id, Math.max(priority, ids.get(node.id) || 0));
    aliases.set(alias, ids);
  }
  return [...aliases].map(([alias, values]) => {
    const highest = Math.max(...values.values());
    return { alias, ids: [...values].filter(([, priority]) => priority === highest).map(([id]) => id) };
  }).sort((left, right) => right.alias.length - left.alias.length);
}

function trimExclusionConnector(value) {
  let next = value;
  while (next) {
    const trimmed = next.replace(/^[\s"'`()[\]{}]+/u, '');
    const connector = trimmed.match(/^(?:(?:the|and|or|module|modules|node|nodes|feature|features)\b|(?:以及|并且|和|与|及|或|、|模块|节点|功能))\s*/iu);
    if (connector) next = trimmed.slice(connector[0].length);
    else return trimmed;
  }
  return next;
}

function aliasStartsPhrase(phrase, alias) {
  if (!phrase.startsWith(alias)) return false;
  const next = phrase.slice(alias.length);
  if (!next) return true;
  if (/^(?:模块|节点|功能)/u.test(next)) return true;
  return !/[\p{L}\p{N}_-]/u.test(next[0]);
}

function exclusionsAfterMarker(value, aliases) {
  const matched = [];
  let remaining = value.toLowerCase().split(/\bbut\b|\binstead\b|(?:但是|但|而是|而要|改为)/u, 1)[0];
  while (remaining) {
    remaining = trimExclusionConnector(remaining);
    const match = aliases.find(item => aliasStartsPhrase(remaining, item.alias));
    if (!match) break;
    matched.push(match);
    remaining = remaining.slice(match.alias.length);
  }
  return matched;
}

export function inferTurnExclusions(task, nodes) {
  const aliases = nodeAliases(nodes);
  const excluded = new Set();
  const ambiguous = [];
  const clauses = String(task || '').split(/[\n,，;；。!?！？]+/u);
  for (const clause of clauses) for (const marker of EXCLUSION_MARKERS) {
    marker.lastIndex = 0;
    for (let found = marker.exec(clause); found; found = marker.exec(clause)) {
      const prefix = clause.slice(0, found.index).trimEnd();
      if (/^(?:排除|exclude|omit)/iu.test(found[0]) && /(?:不要|别|禁止|不应|do not|don't|never|must not|should not)\s*$/iu.test(prefix)) continue;
      for (const match of exclusionsAfterMarker(clause.slice(found.index + found[0].length), aliases)) {
        if (match.ids.length === 1) excluded.add(match.ids[0]);
        else ambiguous.push({ alias: match.alias, candidates: match.ids });
      }
    }
  }
  return {
    exclude: [...excluded],
    ambiguous: [...new Map(ambiguous.map(item => [`${item.alias}\0${item.candidates.join('\0')}`, item])).values()],
  };
}

export function inferTarget(task, nodes, { exclude = [] } = {}) {
  const turnExclusions = inferTurnExclusions(task, nodes);
  const blocked = new Set([...exclude, ...turnExclusions.exclude, ...turnExclusions.ambiguous.flatMap(item => item.candidates)]);
  const lower = task.toLowerCase();
  const available = nodes.filter(node => !blocked.has(node.id));
  const matches = available.filter(node => {
    const candidates = [node.id, node.title, node.label, node.path].filter(Boolean).map(value => String(value).toLowerCase());
    return candidates.some(value => lower.includes(value) || lower.includes(value.split(/[/.]/).at(-1)));
  }).sort((a, b) => b.id.length - a.id.length);
  return matches[0]?.id || (available.length === 1 ? available[0].id : null);
}

export function preview(result, includeContent) {
  const { context, ...summary } = result;
  return { ...summary, ...(includeContent ? { context } : {}) };
}

export function escapeAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
