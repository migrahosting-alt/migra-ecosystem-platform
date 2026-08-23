/**
 * WHICH MigraAuth USER a provider sign-in resolves to.
 *
 * This is the security core of external identity, and it is a PURE function of
 * facts already gathered — no database, no HTTP, no session — so every branch
 * can be enumerated in a test instead of being reasoned about once and hoped
 * over. The dangerous outcomes here are silent: linking to the wrong account
 * looks exactly like a successful sign-in.
 *
 * THE RULE THAT MATTERS: an email may only join two accounts when BOTH sides
 * have verified it. The provider asserting `email_verified` is not enough on its
 * own, and neither is MigraAuth's own verification — the match has to be between
 * two addresses that were each independently proven.
 *
 * Why both. If MigraAuth linked on a provider's UNVERIFIED address, anyone who
 * can get a provider account bearing someone else's address takes over that
 * MigraAuth account. If it linked to an UNVERIFIED MigraAuth account, then
 * anyone who signs up with an address they do not own, and waits, inherits the
 * real owner's provider sign-in. Both are account takeover by registration, and
 * both are invisible to the victim.
 *
 * What the caller does with the outcome is deliberately not decided here.
 */

export type LinkMode = "login" | "link";

/** What the caller looked up before asking. */
export interface LinkingFacts {
  mode: LinkMode;
  /** The user already linked to this provider account, if any. */
  existingLinkUserId: string | null;
  /** The provider's assertion about the address. */
  providerEmail: string | null;
  providerEmailVerified: boolean;
  /** A MigraAuth user holding that address, if any. */
  emailOwnerUserId: string | null;
  /** Whether MigraAuth itself has verified that address. */
  emailOwnerVerified: boolean;
  /** The signed-in user, when this is a deliberate link from settings. */
  sessionUserId: string | null;
  /** Whether that signed-in user already has this provider attached. */
  sessionUserAlreadyLinkedProvider: boolean;
}

export type LinkingDecision =
  /** Sign in as this existing user; the link already exists. */
  | { kind: "sign_in"; userId: string }
  /** Attach the provider account to this user, then sign in. */
  | { kind: "link_and_sign_in"; userId: string }
  /** Attach to the user who is already signed in. No session change. */
  | { kind: "link_to_session"; userId: string }
  /** Make a new MigraAuth user from the provider profile. */
  | { kind: "create_account" }
  /** Refuse, with a reason a human can act on. */
  | { kind: "refuse"; code: LinkingRefusal; message: string };

export type LinkingRefusal =
  | "provider_account_linked_elsewhere"
  | "email_requires_password_login"
  | "email_unverified_at_provider"
  | "provider_already_linked_to_session_user"
  | "link_requires_session";

export function decideLinking(facts: LinkingFacts): LinkingDecision {
  return facts.mode === "link" ? decideLink(facts) : decideLogin(facts);
}

/**
 * Adding a provider to an account you are already signed into.
 *
 * The identity question is already answered by the session, so the only thing
 * left to protect is the provider account: it must not be silently taken from
 * whoever holds it.
 */
function decideLink(facts: LinkingFacts): LinkingDecision {
  if (!facts.sessionUserId) {
    return {
      kind: "refuse",
      code: "link_requires_session",
      message: "Sign in first, then link this provider to your account.",
    };
  }

  if (facts.existingLinkUserId && facts.existingLinkUserId !== facts.sessionUserId) {
    /*
     * MOVING A LINK IS NEVER IMPLICIT. Someone else has proven control of this
     * provider account; re-pointing it would take their sign-in away without
     * telling them. Unlinking is a deliberate act on the account that holds it.
     */
    return {
      kind: "refuse",
      code: "provider_account_linked_elsewhere",
      message: "That account is already linked to a different MigraTeck account.",
    };
  }

  if (facts.existingLinkUserId === facts.sessionUserId) {
    // Already done. Idempotent rather than an error: the user asked for a state
    // that is already true.
    return { kind: "link_to_session", userId: facts.sessionUserId };
  }

  if (facts.sessionUserAlreadyLinkedProvider) {
    // A second Google account on one user is ambiguous at sign-in, because
    // either could resolve the session.
    return {
      kind: "refuse",
      code: "provider_already_linked_to_session_user",
      message: "Your account already has a different account linked for this provider.",
    };
  }

  return { kind: "link_to_session", userId: facts.sessionUserId };
}

/** Signing in with a provider, with or without an account already existing. */
function decideLogin(facts: LinkingFacts): LinkingDecision {
  /*
   * 1. THE LINK IS THE ANSWER WHEN IT EXISTS.
   *
   * Checked before anything email-shaped, because the link was established by a
   * previous proof and the email may since have changed at the provider. A
   * person who changes their Google address must still be themselves.
   */
  if (facts.existingLinkUserId) {
    return { kind: "sign_in", userId: facts.existingLinkUserId };
  }

  // 2. No link, and no address to match on: this can only be a new account.
  if (!facts.providerEmail || !facts.emailOwnerUserId) {
    return { kind: "create_account" };
  }

  /*
   * 3. AN ADDRESS THAT ALREADY BELONGS TO SOMEONE.
   *
   * Both sides must have verified it independently. Anything less is refused
   * toward the password — which the real owner can complete and an impostor
   * cannot — rather than toward a second account, which would leave two
   * accounts holding one address and no way to tell which is real.
   */
  if (!facts.providerEmailVerified) {
    return {
      kind: "refuse",
      code: "email_unverified_at_provider",
      message:
        "That provider has not verified this email address, so it cannot be matched to an existing MigraTeck account. Sign in with your password, then link the provider from your account settings.",
    };
  }

  if (!facts.emailOwnerVerified) {
    return {
      kind: "refuse",
      code: "email_requires_password_login",
      message:
        "An unverified MigraTeck account already uses this email address. Sign in with your password and verify it, then link the provider from your account settings.",
    };
  }

  // Verified on both sides. One person, one account, two ways in.
  return { kind: "link_and_sign_in", userId: facts.emailOwnerUserId };
}
