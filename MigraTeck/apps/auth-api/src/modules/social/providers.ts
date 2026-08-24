/**
 * External identity providers, as DATA rather than as code paths.
 *
 * Adding a third provider is a descriptor in this file and a value in the
 * `IdentityProvider` enum. It is not a change to the routes, the linking rules,
 * the account model, or the session logic — none of which mention Google or
 * GitHub anywhere. That separation is the whole point: the version of this
 * feature that spreads `if (provider === "google")` through the request handlers
 * is the version where the fourth provider is a rewrite.
 *
 * WHAT A DESCRIPTOR MUST PROVIDE is the smallest set of facts that differ
 * between providers: where to send the browser, where to exchange the code, and
 * how to turn an access token into a NORMALIZED profile. Everything downstream —
 * linking, duplicate prevention, session establishment, audit — consumes only
 * the normalized shape.
 */

import { config, providerEnvSuffix } from "../../config/env.js";

/** The only provider-shaped facts the rest of the system is allowed to see. */
export interface ExternalProfile {
  /**
   * The provider's IMMUTABLE subject id. Google `sub`, GitHub numeric `id`.
   *
   * Never the email. Addresses at both providers can be changed and released,
   * so keying an identity on one means a person who changes their address
   * becomes a stranger — and a stranger who acquires the old address becomes
   * them.
   */
  providerAccountId: string;
  email: string | null;
  /** What the PROVIDER asserts. Not the same claim as MigraAuth verification. */
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface ProviderDescriptor {
  id: "GOOGLE" | "GITHUB";
  /** Shown in the UI. */
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /**
   * Whether the provider honours PKCE.
   *
   * GitHub's OAuth apps do not, and sending a challenge it ignores would be
   * security theatre — worse than not sending one, because it reads as
   * protection that is not there. GitHub is protected by the single-use `state`
   * and by the client secret on the exchange, which is the whole of what its
   * flow offers.
   */
  usesPkce: boolean;
  /** Extra authorize parameters this provider needs. */
  authorizeParams?: Record<string, string>;
  fetchProfile: (accessToken: string) => Promise<ExternalProfile>;
}

/** A provider is AVAILABLE only when both halves of its credential are set. */
export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * The provider app this sign-in must use.
 *
 * MIGRAAUTH ORCHESTRATES AUTHENTICATION; EACH PRODUCT OWNS ITS EXTERNAL-PROVIDER
 * PRESENTATION. Google renders the consent screen of the PROJECT its OAuth
 * client belongs to, one brand per project — so "Continue to MigraPilot" is
 * reachable only by giving MigraPilot its own project and client. This is where
 * that choice is made, and it is the ONLY place that knows a product can have
 * its own app: nothing downstream — linking, the account model, sessions, the
 * transaction — changes, because the resulting identity is the same canonical
 * MigraTeck user either way.
 *
 * `productClientId` is the MigraAuth client the sign-in is FOR, not the provider
 * client. Absent (MigraAuth's own login, provider linking from settings) or
 * unmigrated, the shared credential answers, so products move one at a time.
 */
function credentialsFor(
  id: ProviderDescriptor["id"],
  productClientId?: string | null,
): ProviderCredentials | null {
  const creds = id === "GOOGLE" ? config.social.google : config.social.github;

  if (productClientId) {
    const override = creds.byProduct[providerEnvSuffix(productClientId)];
    // Never half-applied: `providerOverrides` refuses to boot with one half of
    // a pair, so an entry here is always complete.
    if (override) return { clientId: override.clientId, clientSecret: override.clientSecret };
  }

  if (!creds.clientId || !creds.clientSecret) return null;
  return { clientId: creds.clientId, clientSecret: creds.clientSecret };
}

/** Which products have their own app for this provider. Diagnostics only. */
export function productsWithOwnApp(id: ProviderDescriptor["id"]): string[] {
  const creds = id === "GOOGLE" ? config.social.google : config.social.github;
  return Object.keys(creds.byProduct).sort();
}

/**
 * Whether this product signs in through its OWN provider app.
 *
 * The callback needs to tell "this product uses the shared app" apart from
 * "this product had its own app when the trip started and no longer does" —
 * a config removal inside the state's ten-minute window. Both resolve to the
 * shared credential, but only the second one guarantees the exchange fails, and
 * it deserves to be reported as a provider that is unavailable rather than as a
 * mysterious rejection from Google.
 */
export function hasOwnProviderApp(
  id: ProviderDescriptor["id"],
  productClientId: string | null | undefined,
): boolean {
  if (!productClientId) return false;
  const creds = id === "GOOGLE" ? config.social.google : config.social.github;
  return creds.byProduct[providerEnvSuffix(productClientId)] !== undefined;
}

const json = async (url: string, accessToken: string): Promise<unknown> => {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "user-agent": "MigraAuth",
    },
  });
  if (!response.ok) {
    throw new ProviderError(`profile request failed (${response.status})`);
  }
  return response.json();
};

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

const GOOGLE: ProviderDescriptor = {
  id: "GOOGLE",
  label: "Google",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scope: "openid email profile",
  usesPkce: true,
  authorizeParams: {
    // Ask every time rather than silently reusing a consent the person may not
    // remember giving, and keep the flow deterministic for the live matrix.
    prompt: "select_account",
  },
  async fetchProfile(accessToken) {
    /*
     * The USERINFO endpoint rather than the `id_token`.
     *
     * Both are trustworthy here for the same reason — this is a server-to-server
     * TLS call to Google, so the response is authenticated by the channel — but
     * userinfo avoids hand-rolling JWT signature verification, which is the kind
     * of code that is either correct or a complete bypass with nothing in
     * between.
     */
    const profile = (await json("https://openidconnect.googleapis.com/v1/userinfo", accessToken)) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    if (!profile.sub) throw new ProviderError("Google returned no subject id.");
    return {
      providerAccountId: profile.sub,
      email: profile.email ?? null,
      emailVerified: profile.email_verified === true,
      displayName: profile.name ?? null,
      avatarUrl: profile.picture ?? null,
    };
  },
};

const GITHUB: ProviderDescriptor = {
  id: "GITHUB",
  label: "GitHub",
  authorizeUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  // `user:email` is required because the public profile's `email` is null for
  // anyone who has not made an address public — which is most people.
  scope: "read:user user:email",
  usesPkce: false,
  async fetchProfile(accessToken) {
    const user = (await json("https://api.github.com/user", accessToken)) as {
      id?: number;
      login?: string;
      name?: string;
      avatar_url?: string;
    };
    if (user.id === undefined) throw new ProviderError("GitHub returned no account id.");

    /*
     * THE PRIMARY VERIFIED ADDRESS, or none.
     *
     * `/user` alone reports whatever the person made public, with no indication
     * of whether GitHub ever confirmed it. `/user/emails` is the only place the
     * `verified` flag exists — and the linking rules turn on exactly that flag,
     * so reading the profile email and assuming it verified would quietly
     * downgrade the safety of every link.
     */
    let email: string | null = null;
    let emailVerified = false;
    try {
      const emails = (await json("https://api.github.com/user/emails", accessToken)) as {
        email?: string;
        primary?: boolean;
        verified?: boolean;
      }[];
      const primary = emails.find((entry) => entry.primary && entry.verified)
        ?? emails.find((entry) => entry.verified);
      if (primary?.email) {
        email = primary.email;
        emailVerified = true;
      }
    } catch {
      // A refused scope leaves us without an address. That is a legitimate
      // state — it means the account links but cannot auto-match an existing
      // one — and it is NOT a reason to fail the sign-in.
    }

    return {
      providerAccountId: String(user.id),
      email,
      emailVerified,
      displayName: user.name ?? user.login ?? null,
      avatarUrl: user.avatar_url ?? null,
    };
  },
};

const DESCRIPTORS: Record<string, ProviderDescriptor> = {
  google: GOOGLE,
  github: GITHUB,
};

/** Resolve a provider from a URL segment, or nothing. Never throws on input. */
export function describeProvider(slug: string): ProviderDescriptor | null {
  return DESCRIPTORS[slug.toLowerCase()] ?? null;
}

/**
 * A provider that is BOTH described and credentialed.
 *
 * The two are separate on purpose. A described-but-unconfigured provider is not
 * an error — it is a deployment that has not been given credentials — and it
 * must surface as "this provider is off", never as a button that leads to a
 * broken consent screen.
 */
export function resolveConfiguredProvider(
  slug: string,
  productClientId?: string | null,
): { descriptor: ProviderDescriptor; credentials: ProviderCredentials } | null {
  const descriptor = describeProvider(slug);
  if (!descriptor) return null;
  const credentials = credentialsFor(descriptor.id, productClientId);
  if (!credentials) return null;
  return { descriptor, credentials };
}

/**
 * What the sign-in UI may offer.
 *
 * Deliberately asked WITHOUT a product: a provider is offered when the
 * deployment can complete it at all. A product-specific app can only change
 * WHICH client answers, never whether the button exists — otherwise adding a
 * per-product override could silently remove a working provider.
 */
export function availableProviders(): { id: string; label: string }[] {
  return Object.entries(DESCRIPTORS)
    .filter(([, descriptor]) => credentialsFor(descriptor.id) !== null)
    .map(([slug, descriptor]) => ({ id: slug, label: descriptor.label }));
}

/** The callback this provider must be registered with. Derived, never typed twice. */
export function callbackUrlFor(slug: string): string {
  return `${config.publicUrl.replace(/\/+$/, "")}/v1/social/${slug}/callback`;
}
