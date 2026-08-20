// MigraPilot Shell — icon set.
//
// Keyed by the CODICON ids used elsewhere in VS Code (`shield`, `diff`,
// `history`, …) so the vocabulary matches the workbench. They are inlined as
// SVG paths rather than loaded from the codicon web-font because the strict
// webview CSP forbids remote resources and the extension does not bundle
// `@vscode/codicons`; swapping to the font later needs no call-site changes.
//
// 16x16 viewBox, `currentColor`, so a tone class colours the icon.

/**
 * Single source of truth for the icon set.
 *
 * Exported so the WEBVIEW script can be given the same map (injected as JSON by
 * `shellScript`), instead of keeping a second hand-maintained copy that silently
 * degrades every unlisted icon to the fallback glyph.
 */
export const ICON_PATHS: Record<string, string> = {
  add: '<path d="M8 2.5v11M2.5 8h11" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
  shield:
    '<path d="M8 1.5l5 1.8v4.1c0 3-2.1 5.6-5 7.1-2.9-1.5-5-4.1-5-7.1V3.3L8 1.5z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.8 8.1l1.6 1.7 3-3.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  checklist:
    '<path d="M6 3.5h8M6 8h8M6 12.5h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M2 3.4l1 1 1.6-1.8M2 7.9l1 1 1.6-1.8M2 12.4l1 1 1.6-1.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  history:
    '<path d="M8 3a5 5 0 104.7 6.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 3V1.4M8 3L6.4 4.4M8 5.6V8l2 1.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  gear: '<circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  diff: '<path d="M4 2.5v11M12 2.5v11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M1.8 6h4.4M4 3.8v4.4M9.8 10h4.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  'comment-discussion':
    '<path d="M1.8 3.2h9.4v6.2H5.4L2.8 11.6V9.4H1.8V3.2z" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M12.8 5.6h1.4v6.2h-1v2.2l-2.6-2.2H7.2" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  code: '<path d="M5.6 4.4L2 8l3.6 3.6M10.4 4.4L14 8l-3.6 3.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  // Run tests — the verification step earns its own glyph rather than borrowing one.
  beaker:
    '<path d="M6.4 1.8v4.1L2.9 12a1.5 1.5 0 001.3 2.2h7.6A1.5 1.5 0 0013.1 12L9.6 5.9V1.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5.6 1.8h4.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M4.5 9.8h7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  search:
    '<circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.2 10.2L14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  rocket:
    '<path d="M9.6 2.6c2.4-.6 3.8.8 3.2 3.2-.5 2-2.4 4-4.6 5L6.4 9.6c1-2.2 3-4.1 5-4.6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6.2 9.4L3 12.6M4.4 7.6L2.2 8.6l1.4 1.4M8.4 11.6l1 2.2 1-2.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  pulse:
    '<path d="M1.6 8h3l1.6-4 2.4 8 1.6-4h4.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  'git-compare':
    '<circle cx="4" cy="12" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="4" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4 10.2V6.4a2.4 2.4 0 012.4-2.4h3.8M12 5.8v3.8a2.4 2.4 0 01-2.4 2.4H5.8" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  'circle-slash':
    '<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4.4 11.6l7.2-7.2" stroke="currentColor" stroke-width="1.3"/>',
  'desktop-download':
    '<path d="M8 2v6.6M5.6 6.4L8 8.8l2.4-2.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.4 10.8v1.8h11.2v-1.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  check: '<path d="M3 8.6l3 3 7-7.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  circle: '<circle cx="8" cy="8" r="3.4" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  x: '<path d="M3.8 3.8l8.4 8.4M12.2 3.8l-8.4 8.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  dash: '<path d="M3.6 8h8.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  warning:
    '<path d="M8 2.4l6 11H2l6-11z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 6.4v3.2M8 11.4v.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  info: '<circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 7.2v4M8 4.9v.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  send: '<path d="M2 8l12-5-4.4 12L7.4 10 2 8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>',
  stop: '<rect x="3.6" y="3.6" width="8.8" height="8.8" rx="1.4" fill="currentColor"/>',
  mic: '<path d="M8 1.8a1.9 1.9 0 00-1.9 1.9v3.4a1.9 1.9 0 003.8 0V3.7A1.9 1.9 0 008 1.8z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4 7.2v.4a4 4 0 008 0v-.4M8 11.6v2.6M5.8 14.2h4.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  paperclip:
    '<path d="M13 7.2l-5.6 5.6a3.1 3.1 0 01-4.4-4.4L8.6 2.8a2 2 0 012.8 2.8L6 11a1 1 0 01-1.4-1.4L9.4 4.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  mention: '<path d="M8 2.4a5.6 5.6 0 105.6 5.6c0-1.1-.9-1.8-1.8-1.8-1 0-1.8.8-1.8 1.8V6.2m0 1.8a2 2 0 11-4 0 2 2 0 014 0z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>',
  'terminal-cmd': '<path d="M6 3.5L3 8l3 4.5M10 3.5L13 8l-3 4.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  menu: '<path d="M2.4 4h11.2M2.4 8h11.2M2.4 12h11.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  'layout-sidebar-right':
    '<rect x="2" y="3" width="12" height="10" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10 3v10" stroke="currentColor" stroke-width="1.3"/>',
  file: '<path d="M4 2h5l3 3v9H4V2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 2v3h3" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  'source-control':
    '<circle cx="5" cy="4" r="1.7" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5" cy="12" r="1.7" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="11.4" cy="8" r="1.7" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5 5.7v4.6M6.7 8h3" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  sync: '<path d="M2.6 8a5.4 5.4 0 019.2-3.8M13.4 8a5.4 5.4 0 01-9.2 3.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M11.8 2.2v2.4H9.4M4.2 13.8v-2.4h2.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  database:
    '<ellipse cx="8" cy="4" rx="5" ry="1.9" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 4v8c0 1 2.2 1.9 5 1.9s5-.9 5-1.9V4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 8c0 1 2.2 1.9 5 1.9s5-.9 5-1.9" fill="none" stroke="currentColor" stroke-width="1.3"/>',
};

const FALLBACK = ICON_PATHS.circle!;

/** Inline SVG for a codicon id. Unknown ids render a neutral circle rather than
 * breaking the layout. Always `aria-hidden` — the accessible name lives on the
 * surrounding control. */
export function icon(id: string): string {
  const body = ICON_PATHS[id] ?? FALLBACK;
  return `<span class="icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false">${body}</svg></span>`;
}

/** Icon ids known to the set — asserted by a unit test so a typo in a model
 * cannot silently degrade every icon to the fallback. */
export function knownIcons(): readonly string[] {
  return Object.keys(ICON_PATHS);
}
