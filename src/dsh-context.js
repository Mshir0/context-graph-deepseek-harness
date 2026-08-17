export function latestUserText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user' || ['plugin', 'tool'].includes(message?.source?.kind)) continue;
    const content = Array.isArray(message.content) ? message.content : [];
    return content.filter(block => block?.type === 'text').map(block => block.text || '').join('\n').trim();
  }
  return '';
}

export function inferTarget(task, nodes) {
  const lower = task.toLowerCase();
  const matches = nodes.filter(node => {
    const candidates = [node.id, node.label, node.path].filter(Boolean).map(value => String(value).toLowerCase());
    return candidates.some(value => lower.includes(value) || lower.includes(value.split(/[/.]/).at(-1)));
  }).sort((a, b) => b.id.length - a.id.length);
  return matches[0]?.id || (nodes.length === 1 ? nodes[0].id : null);
}

export function preview(result, includeContent) {
  const { context, ...summary } = result;
  return { ...summary, ...(includeContent ? { context } : {}) };
}

export function escapeAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
