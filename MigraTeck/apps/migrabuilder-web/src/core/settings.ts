import { contrastRatio } from './contrast';

export type KeybindingAction =
  | 'moveUp'
  | 'moveDown'
  | 'jumpTop'
  | 'jumpBottom'
  | 'outdent'
  | 'indentPrevSection'
  | 'jumpPrevParent'
  | 'jumpNextParent'
  | 'teleportPrevSection'
  | 'teleportNextSection';

export type Keybindings = Record<KeybindingAction, string>;

export type ThemeTokens = {
  accent: string;
  accent2: string;
  bg: string;
  panel: string;
  panel2: string;
  text: string;
  muted: string;
  border: string;
  shadow: string;
  radius: number;
};

export type GlobalSettings = {
  showShortcutsHintDefault: boolean;
  teleportWrap: boolean;
  keybindings: Keybindings;
  theme: ThemeTokens;
};

export type UserSettings = {
  showShortcutsHint: boolean;
  useGlobalKeybindings: boolean;
  keybindingsOverride: Partial<Keybindings>;
};

export type EffectiveSettings = {
  showShortcutsHint: boolean;
  useGlobalKeybindings: boolean;
  teleportWrap: boolean;
  keybindings: Keybindings;
  theme: ThemeTokens;
};

export type SettingsEnvelope = {
  global: GlobalSettings;
  user: UserSettings;
  effective: EffectiveSettings;
  canEditGlobal: boolean;
};

export const KEYBINDING_ACTIONS: Array<{ id: KeybindingAction; label: string; help: string }> = [
  { id: 'moveUp', label: 'Move up', help: 'Move selected element up' },
  { id: 'moveDown', label: 'Move down', help: 'Move selected element down' },
  { id: 'jumpTop', label: 'Jump to top', help: 'Move to first position in parent' },
  { id: 'jumpBottom', label: 'Jump to bottom', help: 'Move to last position in parent' },
  { id: 'outdent', label: 'Outdent', help: 'Move after parent (up a level)' },
  { id: 'indentPrevSection', label: 'Indent into previous section/container', help: 'Move into previous sibling container' },
  { id: 'jumpPrevParent', label: 'Jump previous parent', help: 'Move across parent boundary upward' },
  { id: 'jumpNextParent', label: 'Jump next parent', help: 'Move across parent boundary downward' },
  { id: 'teleportPrevSection', label: 'Teleport prev root section', help: 'Teleport to previous root-level section' },
  { id: 'teleportNextSection', label: 'Teleport next root section', help: 'Teleport to next root-level section' },
];

export const DEFAULT_KEYBINDINGS: Keybindings = {
  moveUp: 'ArrowUp',
  moveDown: 'ArrowDown',
  jumpTop: 'Shift+ArrowUp',
  jumpBottom: 'Shift+ArrowDown',
  outdent: 'Mod+ArrowLeft',
  indentPrevSection: 'Mod+ArrowRight',
  jumpPrevParent: 'Mod+ArrowUp',
  jumpNextParent: 'Mod+ArrowDown',
  teleportPrevSection: 'Mod+Shift+ArrowUp',
  teleportNextSection: 'Mod+Shift+ArrowDown',
};

export const DEFAULT_THEME: ThemeTokens = {
  // Migra brand palette (deep purple → magenta → orange/red).
  accent: '#5E19AE',
  accent2: '#F55144',
  bg: '#070A12',
  panel: '#0D1426',
  panel2: '#121B33',
  text: '#F8FAFC',
  muted: '#A1A1AA',
  border: 'rgba(255,255,255,0.12)',
  shadow: 'rgba(0,0,0,0.45)',
  radius: 18,
};

export const DEFAULT_SETTINGS_ENVELOPE: SettingsEnvelope = {
  global: { showShortcutsHintDefault: true, teleportWrap: false, keybindings: DEFAULT_KEYBINDINGS, theme: DEFAULT_THEME },
  user: { showShortcutsHint: true, useGlobalKeybindings: false, keybindingsOverride: {} },
  effective: {
    showShortcutsHint: true,
    useGlobalKeybindings: false,
    teleportWrap: false,
    keybindings: DEFAULT_KEYBINDINGS,
    theme: DEFAULT_THEME,
  },
  canEditGlobal: false,
};

export function mergeEffectiveKeybindings(globalKb: Keybindings, user: UserSettings): Keybindings {
  if (user.useGlobalKeybindings) return { ...DEFAULT_KEYBINDINGS, ...globalKb };
  return { ...DEFAULT_KEYBINDINGS, ...globalKb, ...(user.keybindingsOverride || {}) };
}

export function diffOverrides(globalKb: Keybindings, nextKb: Keybindings): Partial<Keybindings> {
  const overrides: Partial<Keybindings> = {};
  (Object.keys(DEFAULT_KEYBINDINGS) as KeybindingAction[]).forEach((k) => {
    const g = String(globalKb[k] ?? DEFAULT_KEYBINDINGS[k] ?? '').trim();
    const n = String(nextKb[k] ?? '').trim();
    if (!n) return;
    if (n !== g) overrides[k] = n;
  });
  return overrides;
}

export function normalizeKeyName(key: string): string {
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function comboFromEvent(e: KeyboardEvent): string | null {
  const key = normalizeKeyName(e.key);
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(key)) return null;

  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('Mod');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');

  return [...mods, key].join('+');
}

type ParsedCombo = {
  wantShift: boolean;
  wantAlt: boolean;
  wantCtrl: boolean;
  wantMeta: boolean;
  wantMod: boolean;
  key: string;
};

function parseCombo(combo: string): ParsedCombo | null {
  const raw = String(combo || '').trim();
  if (!raw) return null;
  const parts = raw
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
  const key = normalizeKeyName(parts[parts.length - 1]);

  return {
    wantShift: mods.has('shift'),
    wantAlt: mods.has('alt'),
    wantCtrl: mods.has('ctrl') || mods.has('control'),
    wantMeta: mods.has('cmd') || mods.has('meta'),
    wantMod: mods.has('mod'),
    key,
  };
}

/**
 * Canonical string form for comparing combos:
 * - modifier order is Mod + Alt + Shift (stable)
 * - key normalized via normalizeKeyName()
 */
export function canonicalizeCombo(combo: string): string {
  const parsed = parseCombo(combo);
  if (!parsed) return '';

  const mods: string[] = [];
  if (parsed.wantMod || parsed.wantCtrl || parsed.wantMeta) mods.push('Mod');
  if (parsed.wantAlt) mods.push('Alt');
  if (parsed.wantShift) mods.push('Shift');

  return [...mods, parsed.key].join('+');
}

export function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  const parsed = parseCombo(combo);
  if (!parsed) return false;

  const key = normalizeKeyName(e.key);
  if (key !== parsed.key) return false;

  const pressedShift = e.shiftKey;
  const pressedAlt = e.altKey;
  const pressedCtrl = e.ctrlKey;
  const pressedMeta = e.metaKey;

  if (parsed.wantMod) {
    if (!(pressedCtrl || pressedMeta)) return false;
  } else if (parsed.wantCtrl || parsed.wantMeta) {
    const wantsCtrl = parsed.wantCtrl;
    const wantsMeta = parsed.wantMeta;
    if (wantsCtrl !== pressedCtrl) return false;
    if (wantsMeta !== pressedMeta) return false;
  } else {
    if (pressedCtrl || pressedMeta) return false;
  }

  if (pressedShift !== parsed.wantShift) return false;
  if (pressedAlt !== parsed.wantAlt) return false;

  return true;
}

function bestForegroundFor(backgrounds: string[], candidates: string[]): string {
  const bgs = backgrounds.filter((c) => typeof c === 'string' && c.trim().startsWith('#'));
  const opts = candidates.filter((c) => typeof c === 'string' && c.trim().startsWith('#'));
  if (bgs.length === 0 || opts.length === 0) return candidates[0] || '#F8FAFC';

  let best = opts[0];
  let bestMin = -1;
  for (const cand of opts) {
    let min = Infinity;
    for (const bg of bgs) {
      const r = contrastRatio(cand, bg);
      if (r == null) continue;
      min = Math.min(min, r);
    }
    if (min === Infinity) continue;
    if (min > bestMin) {
      bestMin = min;
      best = cand;
    }
  }
  return best;
}

export function ensureReadableThemeTokens(theme: ThemeTokens): ThemeTokens {
  const backgrounds = [theme.bg, theme.panel, theme.panel2];

  const text = bestForegroundFor(backgrounds, [theme.text, '#0F172A', '#F8FAFC']);
  const muted = bestForegroundFor(backgrounds, [theme.muted, '#64748B', '#A1A1AA']);

  return { ...theme, text, muted };
}

// Standalone: settings are stored in localStorage only (no server persistence for Phase 1)
export async function saveSettingsEnvelope(params: {
  scope: 'user' | 'global';
  settings: Record<string, unknown>;
  // kept for API compat but unused
  ajaxUrl?: string;
  nonce?: string;
}): Promise<SettingsEnvelope> {
  const key = `migra_settings_${params.scope}`;
  try {
    localStorage.setItem(key, JSON.stringify(params.settings));
  } catch {
    // localStorage unavailable
  }
  // Return base envelope — caller will re-normalize
  return DEFAULT_SETTINGS_ENVELOPE;
}
