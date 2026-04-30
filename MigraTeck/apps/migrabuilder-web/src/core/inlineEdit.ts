export type InlineEditKind = 'input' | 'textarea';

export type InlineEditSpec = {
  key: string;
  kind: InlineEditKind;
};

const DIRECT: Record<string, InlineEditSpec> = {
  heading: { key: 'title', kind: 'textarea' },
  button: { key: 'text', kind: 'input' },
  'text-editor': { key: 'editor', kind: 'textarea' },
};

export function resolveInlineEditSpec(nodeType: string, props: Record<string, any> | null | undefined): InlineEditSpec | null {
  const type = String(nodeType || '').trim();
  const direct = DIRECT[type];
  if (direct) {
    if (props && typeof props === 'object' && direct.key in props) return direct;
    return direct;
  }

  // Heuristic fallback for unknown widgets.
  if (!props || typeof props !== 'object') return null;
  if ('title' in props) return { key: 'title', kind: 'textarea' };
  if ('text' in props) return { key: 'text', kind: 'input' };
  if ('editor' in props) return { key: 'editor', kind: 'textarea' };
  return null;
}

