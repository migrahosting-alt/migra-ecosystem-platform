"use client";

/**
 * Password management.
 *
 * WHY THIS PAGE EXISTS. "Manage password" used to open the SESSION LIST — a
 * page about devices, with no password control on it. For an account created
 * through Google or GitHub there was no route to a password at all: the only
 * password flow was the emailed reset token, which is a recovery path for
 * someone locked out, not a way to add a credential on purpose.
 *
 * That left `unlinkProvider`'s safeguard giving advice nobody could follow —
 * "Set a password first, then unlink this provider" — and a provider-only
 * account permanently one credential wide.
 *
 * THE SERVER DECIDES WHAT PROOF IS REQUIRED; this page only asks for what the
 * account can actually produce. Rendering a "current password" box to someone
 * who has never had one is the same mistake in a different layer.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button, PasswordInput, Input, toBrandStyle } from "@migrateck/auth-ui";
import { authFetch } from "@/lib/api";
import { resolveAuthBrandTheme } from "@/lib/branding";
import { useRegistryBrand } from "@/lib/useRegistryBrand";

type SecurityFacts = {
  /**
   * The product this SESSION was established for, stamped server-side when its
   * authorization transaction was consumed. Never a query parameter: branding
   * driven by one would let anyone make MigraAuth wear any product's identity.
   */
  product_client_id: string | null;
  mfa_enabled: boolean;
  has_password: boolean;
  password_updated_at: string | null;
  linked_providers: string[];
  sign_in_methods: number;
  can_unlink_a_provider: boolean;
};

type PasswordResponse = SecurityFacts & {
  success?: boolean;
  created?: boolean;
  message?: string;
  /**
   * Set on success. The session that made the change is already revoked by the
   * time this arrives, so there is nothing to stay on — only somewhere to go.
   */
  reauthenticate?: { required?: boolean; url?: string; product_client_id?: string | null };
  error?: { code?: string; message?: string };
};

const MIN_LENGTH = 10;

const PROVIDER_LABEL: Record<string, string> = { google: "Google", github: "GitHub" };
const labelFor = (slug: string) => PROVIDER_LABEL[slug] ?? slug;

/**
 * NO RAW API ERRORS REACH THE PAGE. Every failure this endpoint can return is
 * named here with something a person can act on; anything unrecognised falls
 * back to a plain sentence rather than a JSON fragment or a status code.
 */
function describeFailure(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case "reauthentication_required":
      return "For your security, sign in again and then set your password. This page will be waiting.";
    case "reauthentication_failed":
      return "That did not match. Check what you entered and try again.";
    case "password_unchanged":
      return "That is already your password. Choose a different one.";
    case "validation_error":
      return `Choose a password of at least ${MIN_LENGTH} characters.`;
    default:
      return fallback && !/^[{[]/.test(fallback)
        ? fallback
        : "Something went wrong and your password was not changed. Try again.";
  }
}

export default function PasswordPage() {
  /*
   * ── THE PRODUCT CONTEXT FOLLOWS YOU INTO ACCOUNT SECURITY ────────────
   *
   * Signing in to MigraPilot shows MigraPilot; opening "Manage password" from
   * MigraPilot's settings used to drop you into a generic MigraAuth page
   * mid-journey. Same account, same task, different identity on screen.
   *
   * The client id comes from the SESSION, which recorded it when a transaction
   * was consumed — trusted server state, exactly like /login reads it from the
   * transaction row. There is deliberately no `client_id` query parameter here:
   * this page is reached by a plain link, and honouring a URL parameter would
   * let anyone dress MigraAuth as any product.
   *
   * Null — signing in at MigraAuth directly — resolves to MigraAuth's own
   * brand, which is the honest answer rather than a missing one.
   */
  const [productClientId, setProductClientId] = useState<string | null>(null);
  const hardcodedBrand = useMemo(() => resolveAuthBrandTheme(productClientId), [productClientId]);
  const brand = useRegistryBrand(productClientId, hardcodedBrand);
  const brandStyle = useMemo(() => toBrandStyle(brand), [brand]);
  const isProductContext = brand.productKey !== "migraauth";

  const [facts, setFacts] = useState<SecurityFacts | null>(null);
  const [loadError, setLoadError] = useState("");
  /*
   * TRACKED SEPARATELY FROM `facts`, because "we have no facts" is two different
   * states and they must not read the same. Branching the heading on
   * `facts === null` alone left a failed load saying "Loading your account
   * security settings…" FOREVER, directly above the message explaining that it
   * had finished and failed. A spinner that never resolves is worse than an
   * error: it tells someone to wait for something that is not coming.
   */
  const [loading, setLoading] = useState(true);
  const [loadNeedsSignIn, setLoadNeedsSignIn] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [saving, setSaving] = useState(false);
  const [reauthUrl, setReauthUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [needsFreshSignIn, setNeedsFreshSignIn] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await authFetch<SecurityFacts>("/v1/me/security");
      if (!response.ok) {
        setLoadNeedsSignIn(response.status === 401);
        setLoadError(
          response.status === 401
            ? "Sign in to your MigraTeck account to set or change your password."
            : "We could not load your account security settings.",
        );
        return;
      }
      setFacts(response.data);
      setProductClientId(response.data.product_client_id);
    } catch {
      setLoadError("We could not reach your account. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isChange = facts?.has_password ?? false;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < MIN_LENGTH;

  /*
   * The submit button is disabled only for things the PAGE can be sure about —
   * length, the confirmation matching, an empty required field. Whether the
   * proof is sufficient is the server's call, and pre-judging it here is how a
   * form ends up refusing a request the API would have accepted.
   */
  const canSubmit =
    !saving &&
    newPassword.length >= MIN_LENGTH &&
    newPassword === confirmPassword &&
    (!isChange || currentPassword.length > 0 || code.length > 0) &&
    (isChange || !facts?.mfa_enabled || code.length > 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError("");
    setSuccess("");
    setNeedsFreshSignIn(false);

    try {
      const response = await authFetch<PasswordResponse>("/v1/me/password", {
        method: "POST",
        body: {
          new_password: newPassword,
          ...(currentPassword ? { current_password: currentPassword } : {}),
          ...(code ? { code } : {}),
        },
      });

      if (!response.ok) {
        const failureCode = response.data?.error?.code;
        setNeedsFreshSignIn(failureCode === "reauthentication_required");
        setError(describeFailure(failureCode, response.data?.error?.message));
        return;
      }

      /*
       * The new facts come back IN the response, so the safeguard state and the
       * "ways to sign in" count update from what the database now says rather
       * than from an assumption about what just happened.
       */
      setFacts(response.data);
      setCurrentPassword("");
      setCode("");
      setNewPassword("");
      setConfirmPassword("");

      /*
       * NOT A PERMANENT SUCCESS SCREEN. The server has already ended this
       * session, because a stored password is not a working one until it has
       * signed somebody in. Staying here would show a green tick over a
       * credential nobody has used yet — and this browser can no longer do
       * anything on this page anyway.
       */
      const target = response.data.reauthenticate?.url ?? "/login";
      setReauthUrl(target);
      setSuccess(
        response.data.created
          ? "Password saved. Signing you in again to confirm it works…"
          : "Password changed. Signing you in again to confirm it works…",
      );
      // A beat to read the message, then the journey continues on its own.
      window.setTimeout(() => { window.location.assign(target); }, 1600);
    } catch {
      setError("We could not reach your account. Your password was not changed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen text-white" style={brandStyle}>
      <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,#080b20_0%,#0f1733_48%,#080b20_100%)]" />
        <div className="pointer-events-none absolute -left-40 top-16 h-[500px] w-[500px] rounded-full blur-[120px]" style={{ background: "var(--brand-start)", opacity: 0.18 }} />
        <div className="pointer-events-none absolute -right-32 bottom-16 h-[400px] w-[400px] rounded-full blur-[100px]" style={{ background: "var(--brand-end)", opacity: 0.14 }} />
        <div className="absolute inset-0 -z-10 opacity-[0.03] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),transparent)]" />

        <div className="w-full max-w-[560px]">
          <div className="relative overflow-hidden rounded-[28px] border border-white/[0.14] bg-white/[0.06] p-8 shadow-[0_26px_90px_rgba(3,7,18,0.38)] backdrop-blur-xl sm:p-9">
            <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent)]" />
            <div className="pointer-events-none absolute inset-[1px] rounded-[27px] border border-white/[0.06]" />

            <div className="relative space-y-6">
              {/*
                NEUTRAL UNTIL THE PRODUCT IS KNOWN.
                Product context arrives with `/v1/me/security`, so rendering the
                default brand first meant MigraPilot users watched a MigraAuth
                page turn into a MigraPilot one. That flicker is not merely
                untidy: read mid-swap it says the feature is broken, and it was
                reported as exactly that. Showing nothing for a moment is honest;
                showing the wrong identity and correcting it is not.
              */}
              <div className="flex justify-center">
                <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur-sm">
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-2xl">
                    {loading ? (
                      <div className="h-full w-full animate-pulse rounded-2xl bg-white/10" />
                    ) : (
                      <Image src={brand.logoSrc ?? "/brands/migrateck-logo.png"} alt={brand.productName} fill className="object-contain" priority />
                    )}
                  </div>
                  <div className="text-left leading-none">
                    <div className="text-lg font-semibold tracking-[-0.02em] text-white">
                      {loading ? <span className="inline-block h-4 w-24 animate-pulse rounded bg-white/10" /> : brand.productName}
                    </div>
                    <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.26em] text-white/50">Account security</div>
                  </div>
                </div>
              </div>

              <div className="text-center">
                {/*
                  NAMES THE PRODUCT YOU CAME FROM, because "Set a password" in
                  the middle of a MigraPilot journey reads as a different
                  system's page. With no product context the plain wording is
                  correct and the product suffix would be a lie.
                */}
                <h1 className="text-2xl font-semibold tracking-tight text-white">
                  {facts === null
                    ? "Password"
                    : isChange
                      ? isProductContext
                        ? `Change your password for ${brand.productName}`
                        : "Change your password"
                      : isProductContext
                        ? `Set a password for ${brand.productName}`
                        : "Set a password"}
                </h1>
                {/*
                  Says "loading" only while it IS loading. Once the request has
                  settled without facts, the message below explains why — and
                  repeating it here would say the same thing twice.
                */}
                {loading || facts !== null ? (
                  <p className="mt-2 text-sm text-white/50">
                    {/*
                      ONE CREDENTIAL, NOT A PER-PRODUCT ONE. The heading names
                      the product, so this line has to say plainly what the
                      password actually is — the MigraTeck account's, managed by
                      MigraAuth. Without it, "Set a password for MigraPilot"
                      invites people to believe they are creating a separate
                      MigraPilot password, and they will look for it later.
                    */}
                    {loading
                      ? "Loading your account security settings…"
                      : isProductContext
                        ? "This password is managed securely by MigraAuth and works with your MigraTeck account."
                        : isChange
                          ? "Choose a new password for signing in to your MigraTeck account."
                          : "Add a password so you can sign in without a connected account."}
                  </p>
                ) : null}
              </div>

              {loadError ? (
                <div className="space-y-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                  <p>{loadError}</p>
                  {/* A dead end otherwise: the one thing that fixes a 401 here. */}
                  {loadNeedsSignIn ? (
                    <Link href="/login" className="inline-flex text-sm font-semibold text-white underline underline-offset-4">
                      Sign in
                    </Link>
                  ) : null}
                </div>
              ) : null}

              {/* ── WHAT IS TRUE RIGHT NOW ───────────────────────────────
                  Stated before any control, because "is password sign-in on?"
                  was one of the questions this surface did not answer. */}
              {facts ? (
                <div className="space-y-2 rounded-2xl border border-white/10 bg-black/15 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-white/60">Password sign-in</span>
                    <span className={`text-sm font-semibold ${facts.has_password ? "text-emerald-300" : "text-white/70"}`}>
                      {facts.has_password ? "On" : "Not set up"}
                    </span>
                  </div>
                  {facts.has_password && facts.password_updated_at ? (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-white/60">Last changed</span>
                      <span className="text-sm text-white/80">
                        {new Date(facts.password_updated_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-white/60">Connected accounts</span>
                    <span className="text-sm text-white/80">
                      {facts.linked_providers.length > 0
                        ? facts.linked_providers.map(labelFor).join(", ")
                        : "None"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-white/60">Ways to sign in</span>
                    <span className="text-sm font-semibold text-white/90">{facts.sign_in_methods}</span>
                  </div>
                  {/*
                    THE SAFEGUARD, EXPLAINED WHERE IT CAN BE ACTED ON. Being
                    told "you cannot remove your last sign-in method" while
                    standing on the page that fixes it is the whole point.
                  */}
                  {!facts.can_unlink_a_provider && facts.linked_providers.length > 0 ? (
                    <p className="pt-1 text-[13px] leading-relaxed text-white/45">
                      {labelFor(facts.linked_providers[0]!)} is currently the only way into your account, so it
                      cannot be disconnected. Setting a password here gives you a second way in.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {success ? (
                <div className="space-y-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                  <p>{success}</p>
                  {/*
                    A LINK, NOT ONLY A TIMER. If the automatic redirect is
                    blocked or the tab is backgrounded, the person is stranded on
                    a page whose session no longer exists — with no way forward
                    and a password they have not yet proved.
                  */}
                  {reauthUrl ? (
                    <a href={reauthUrl} className="inline-flex text-sm font-semibold text-white underline underline-offset-4">
                      Continue to sign in
                    </a>
                  ) : null}
                </div>
              ) : null}

              {error ? (
                <div className="space-y-3 rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  <p>{error}</p>
                  {needsFreshSignIn ? (
                    <Link href="/login" className="inline-flex text-sm font-semibold text-white underline underline-offset-4">
                      Sign in again
                    </Link>
                  ) : null}
                </div>
              ) : null}

              {facts && !reauthUrl ? (
                <form onSubmit={submit} className="space-y-4">
                  {/*
                    ASKED FOR ONLY WHEN IT EXISTS. An account with no password
                    is never shown a "current password" box — that box is the
                    one-way door that made MFA undisableable for provider-only
                    accounts, rebuilt in the UI.
                  */}
                  {isChange ? (
                    <PasswordInput
                      label="Current password"
                      id="current-password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      hint={facts.mfa_enabled ? "Or use an authenticator code below." : undefined}
                    />
                  ) : null}

                  {facts.mfa_enabled ? (
                    <Input
                      label={isChange ? "Authenticator code (instead of your password)" : "Authenticator code"}
                      inputMode="numeric"
                      id="mfa-code"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      value={code}
                      onChange={(event) => setCode(event.target.value.trim())}
                      hint="A code from your authenticator app, or one of your recovery codes."
                    />
                  ) : null}

                  <PasswordInput
                    label={isChange ? "New password" : "Password"}
                      id="new-password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    hint={`At least ${MIN_LENGTH} characters.`}
                    error={tooShort ? `Use at least ${MIN_LENGTH} characters.` : undefined}
                  />

                  <PasswordInput
                    label="Confirm password"
                      id="confirm-password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    error={mismatch ? "These do not match." : undefined}
                  />

                  <Button type="submit" className="w-full" disabled={!canSubmit}>
                    {saving ? "Saving…" : isChange ? "Change password" : "Set password"}
                  </Button>
                </form>
              ) : null}

              {/*
                THE IDENTITY AUTHORITY STAYS EXPLICIT. A product-skinned page
                that handles credentials and never says who actually operates it
                is the shape a phishing page takes. Omitted on MigraAuth's own
                surface, where it would only say MigraAuth is secured by
                MigraAuth. Same rule and same wording as the sign-in footer.
              */}
              {isProductContext ? (
                <p className="text-center text-[11px] leading-4 tracking-wide text-white/35">
                  Secured by MigraAuth
                </p>
              ) : null}

              <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4 text-sm">
                <Link href="/sessions" className="text-white/50 transition hover:text-white/80">
                  Active sessions
                </Link>
                {facts?.has_password ? (
                  <Link href="/forgot-password" className="text-white/50 transition hover:text-white/80">
                    Forgot your password?
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
