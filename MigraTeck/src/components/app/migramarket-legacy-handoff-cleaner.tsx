"use client";

import { useEffect } from "react";

const LEGACY_HANDOFF_PARAM_KEYS = ["legacySocial", "legacySource", "legacyPath"] as const;

export function MigraMarketLegacyHandoffCleaner() {
  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;

    for (const key of LEGACY_HANDOFF_PARAM_KEYS) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }

    if (!changed) {
      return;
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, []);

  return null;
}
