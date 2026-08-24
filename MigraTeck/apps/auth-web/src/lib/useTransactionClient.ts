"use client";

import { useEffect, useState } from "react";
import { authFetch } from "./api";

/**
 * Which product a durable authorization transaction belongs to.
 *
 * WHY EVERY AUTH PAGE NEEDS THIS. The durable transaction deliberately removed
 * `client_id`, `redirect_uri`, scopes and the PKCE challenge from the browser's
 * URL — that is the security property it exists for. But branding was reading
 * `client_id` from the query string, so with only `txn` present it resolved to
 * nothing and every page fell back to MigraAuth's own brand. A MigraPilot user
 * was shown a MigraAuth login.
 *
 * THE TRANSACTION IS A BETTER SOURCE THAN THE PARAMETER IT REPLACED. A query
 * parameter can be edited, so branding driven by it lets anyone make MigraAuth
 * wear any product's identity. The transaction row records which client actually
 * initiated the request.
 *
 * ONE HOOK, NOT THREE COPIES. `/login`, `/signup` and `/mfa` all receive `txn`
 * and all need the same answer; three implementations would drift, and the one
 * that drifted would be the one nobody noticed showing the wrong brand.
 *
 * Only the CLIENT is taken. `toPublicView` exposes id, clientId, clientName,
 * prompt, loginHint and expiry — not the redirect, scopes or challenge — so a
 * page holding this still cannot reconstruct the authorization request.
 *
 * Failure is silent by design: no client resolved means MigraAuth's own brand,
 * which is the honest answer for a sign-in whose product is unknown.
 */
export function useTransactionClientId(txn: string | null): string | null {
  const [clientId, setClientId] = useState<string | null>(null);

  useEffect(() => {
    if (!txn) return;
    let cancelled = false;

    void authFetch<{ transaction?: { clientId?: string } }>(
      `/v1/authorize/transaction/${encodeURIComponent(txn)}`,
    )
      .then((response) => {
        if (!cancelled && response.ok && response.data?.transaction?.clientId) {
          setClientId(response.data.transaction.clientId);
        }
      })
      .catch(() => {
        /* keep the default brand */
      });

    return () => {
      cancelled = true;
    };
  }, [txn]);

  /*
   * Gated on `txn` rather than reset in the effect. Clearing state inside the
   * effect would be a synchronous setState on every render where `txn` is
   * absent, which cascades renders for no benefit — deriving the answer is both
   * cheaper and impossible to get out of sync.
   */
  return txn ? clientId : null;
}
