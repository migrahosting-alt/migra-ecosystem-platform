'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_PREFERENCES,
  type Density,
  type Theme,
  type UserPreferences,
} from '@migrapilot/shared-types/user-preferences'

/**
 * Appearance, applied to the whole app.
 *
 * FOUR ATTRIBUTES ON <html>, AND NOTHING ELSE. Theme, density, reduced motion
 * and high contrast are written to the document element; every rule that reacts
 * to them lives in `globals.css`. No component reads a preference to decide how
 * it looks, which is what keeps a new screen themed without anyone remembering
 * to theme it.
 *
 * TWO SOURCES, ONE PRECEDENCE. The account's stored preferences are
 * authoritative whenever they can be read — they follow the person between
 * devices. `localStorage` is the device-local fallback that makes the page
 * correct BEFORE that read completes, and the only source a visitor has if the
 * preferences service is unreachable. The account always wins once it answers,
 * so a stale device value cannot override a deliberate change made elsewhere.
 *
 * THE FIRST PAINT IS HANDLED BY A BLOCKING SCRIPT, not by this component. React
 * mounts after the browser has already painted, so a dark-mode user would see a
 * white flash on every navigation if the attributes waited for hydration. See
 * `appearanceBootScript`.
 */

const STORAGE_KEY = 'migrapilot.appearance'

interface AppearanceState {
  theme: Theme
  density: Density
  reduceMotion: boolean
  highContrast: boolean
}

const FALLBACK: AppearanceState = {
  theme: DEFAULT_PREFERENCES.theme,
  density: DEFAULT_PREFERENCES.density,
  reduceMotion: DEFAULT_PREFERENCES.reduceMotion,
  highContrast: DEFAULT_PREFERENCES.highContrast,
}

/**
 * Runs before first paint, inlined into <head>.
 *
 * Deliberately tiny and dependency-free: it blocks rendering, so every byte and
 * every branch is paid for on the critical path of every page load. It reads
 * only what it needs and never throws — a corrupt or unreadable value must fall
 * through to the default rather than break the document.
 */
export const appearanceBootScript = `(function(){try{
var d=document.documentElement;
var s=null;try{s=JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})||'null')}catch(e){}
var t=(s&&s.theme)||'system';
d.setAttribute('data-theme',t);
d.setAttribute('data-density',(s&&s.density)||'comfortable');
if(s&&s.reduceMotion)d.setAttribute('data-reduce-motion','true');
if(s&&s.highContrast)d.setAttribute('data-high-contrast','true');
var m=window.matchMedia('(prefers-color-scheme: dark)');
d.setAttribute('data-system-dark',m.matches?'true':'false');
}catch(e){}})();`

function apply(state: AppearanceState): void {
  const root = document.documentElement
  root.setAttribute('data-theme', state.theme)
  root.setAttribute('data-density', state.density)
  /*
   * Absent rather than "false". A CSS selector matching `[data-reduce-motion]`
   * is easy to write by accident; an attribute that only exists when the setting
   * is on cannot be matched when it is off.
   */
  if (state.reduceMotion) root.setAttribute('data-reduce-motion', 'true')
  else root.removeAttribute('data-reduce-motion')
  if (state.highContrast) root.setAttribute('data-high-contrast', 'true')
  else root.removeAttribute('data-high-contrast')
}

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [, setState] = useState<AppearanceState>(FALLBACK)
  /** Mirrors state for the media listener without re-subscribing on every change. */
  const current = useRef<AppearanceState>(FALLBACK)

  const set = useCallback((next: AppearanceState) => {
    current.current = next
    setState(next)
    apply(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Private browsing, or storage disabled. The account read still governs
      // this session; only the pre-paint shortcut is lost.
    }
  }, [])

  /*
   * SYSTEM THEME FOLLOWS THE OS LIVE. `data-system-dark` is kept current
   * whatever the chosen theme is, so switching the OS to dark while the app is
   * open re-themes it immediately — and switching the app to System later is
   * correct straight away rather than until the next reload.
   */
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const sync = () =>
      document.documentElement.setAttribute('data-system-dark', media.matches ? 'true' : 'false')
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  /*
   * The stored document is authoritative. It is read once on mount and applied
   * over whatever the boot script guessed from this device.
   */
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const response = await fetch('/api/preferences', { cache: 'no-store' })
        if (!response.ok || !live) return
        const body = (await response.json()) as { preferences?: UserPreferences }
        const p = body.preferences
        if (!p || !live) return
        set({
          theme: p.theme,
          density: p.density,
          reduceMotion: p.reduceMotion,
          highContrast: p.highContrast,
        })
      } catch {
        // Unreachable preferences leave the device-local values in place, which
        // is the correct fallback rather than snapping back to defaults.
      }
    })()
    return () => {
      live = false
    }
  }, [set])

  /*
   * Settings changes reach here without a reload. `usePreferences` saves, then
   * announces — this listens rather than sharing state, so the appearance system
   * has no dependency on which screen happens to be mounted.
   */
  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<Partial<AppearanceState>>).detail
      if (!detail) return
      set({ ...current.current, ...detail })
    }
    window.addEventListener('migrapilot:appearance', onChanged)
    return () => window.removeEventListener('migrapilot:appearance', onChanged)
  }, [set])

  return <>{children}</>
}

/** Announce an appearance change so the provider applies it immediately. */
export function announceAppearance(patch: Partial<UserPreferences>): void {
  const relevant: Partial<AppearanceState> = {}
  if (patch.theme !== undefined) relevant.theme = patch.theme
  if (patch.density !== undefined) relevant.density = patch.density
  if (patch.reduceMotion !== undefined) relevant.reduceMotion = patch.reduceMotion
  if (patch.highContrast !== undefined) relevant.highContrast = patch.highContrast
  if (Object.keys(relevant).length === 0) return
  window.dispatchEvent(new CustomEvent('migrapilot:appearance', { detail: relevant }))
}
