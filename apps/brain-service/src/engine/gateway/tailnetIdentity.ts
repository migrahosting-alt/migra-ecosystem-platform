/*
 * WHO IS CALLING, according to the tailnet.
 *
 * The Brain is reached through `tailscale serve`, which terminates TLS on the
 * node and proxies to loopback. Serve annotates proxied requests with the
 * identity of the CALLING TAILNET USER. That is a materially better signal than
 * the network position: any node on the tailnet can open a TCP connection, but
 * only a user-owned node carries a user.
 *
 * The distinction that matters here: a TAGGED node — a server like mail-core or
 * voip-core, owned by a tag rather than a person — has no user identity, so
 * Serve sends no user headers for it. Enforcing on these headers therefore
 * separates "a person using MigraPilot" from "some server on the tailnet",
 * which is exactly the boundary a network ACL could not express without
 * restructuring the whole tailnet.
 *
 * TRUST BOUNDARY, STATED PLAINLY: these headers are trustworthy ONLY because
 * Serve sets them on the node itself and the Brain listens on loopback, so no
 * remote client can reach it without passing through Serve. If the Brain were
 * ever bound to a routable interface, or put behind a proxy that forwards
 * client-supplied headers, this becomes spoofable and MUST NOT be relied on.
 * That is why the binding is asserted, not assumed.
 */

/** Headers Tailscale Serve adds for a request from a user-owned node. */
export const TAILNET_LOGIN_HEADER = 'tailscale-user-login';
export const TAILNET_NAME_HEADER = 'tailscale-user-name';
export const TAILNET_PROFILE_HEADER = 'tailscale-user-profile-pic';

export interface TailnetIdentity {
  /** The tailnet user's login (an email-shaped identifier), when present. */
  login?: string;
  /** Display name, when present. */
  name?: string;
  /** True when Serve supplied a user identity at all. */
  present: boolean;
  /** Which of the known identity headers actually arrived — for diagnosis. */
  headersSeen: string[];
}

type HeaderBag = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
};

/**
 * Read the tailnet identity off an incoming request.
 *
 * Returns `present: false` rather than throwing when nothing arrived: the
 * caller decides whether that is a refusal or merely an observation, and during
 * rollout it is deliberately only an observation.
 */
export function readTailnetIdentity(headers: HeaderBag): TailnetIdentity {
  const login = first(headers[TAILNET_LOGIN_HEADER])?.trim();
  const name = first(headers[TAILNET_NAME_HEADER])?.trim();
  const seen: string[] = [];
  for (const h of [TAILNET_LOGIN_HEADER, TAILNET_NAME_HEADER, TAILNET_PROFILE_HEADER]) {
    if (first(headers[h])) seen.push(h);
  }
  return {
    ...(login ? { login } : {}),
    ...(name ? { name } : {}),
    present: Boolean(login),
    headersSeen: seen,
  };
}

/*
 * THE ACCESS RULE, built on measurements rather than assumptions.
 *
 * Three caller shapes were measured against the live endpoint, and they are
 * distinguishable:
 *
 *   user-owned node, via Serve   identity PRESENT   x-forwarded-for set
 *   tagged server, via Serve     identity absent    x-forwarded-for set
 *   on-host loopback caller      identity absent    x-forwarded-for ABSENT
 *
 * So `x-forwarded-for` answers "did this arrive through Serve", and the identity
 * headers answer "is there a person behind it". An identity-less request is
 * refused only in the first case: a tagged server like mail-core gets nothing,
 * while on-host callers — monitoring, local services — keep working untouched.
 *
 * SPOOFING WAS TESTED, NOT ASSUMED. A tagged node sending its own
 * `Tailscale-User-Login` header reached the Brain with NO identity: Serve
 * overrides client-supplied identity headers. And a Serve-proxied request cannot
 * hide its origin by omitting `x-forwarded-for`, because Serve sets it. The
 * remaining trust condition is the binding: this holds only while the Brain
 * listens on loopback and Serve is the sole route in.
 */

export type TailnetAccess =
  | { allow: true; reason: 'on_host' | 'tailnet_user' | 'enforcement_disabled'; login?: string }
  | { allow: false; reason: 'tagged_node_without_user' | 'user_not_allowed'; login?: string };

export interface AccessOptions {
  /** When false, decisions are still computed but never refuse. */
  enforce: boolean;
  /** Optional login allowlist. Empty means "any tailnet user", which is the default. */
  allowedLogins?: readonly string[];
}

export function decideTailnetAccess(headers: HeaderBag, opts: AccessOptions): TailnetAccess {
  const identity = readTailnetIdentity(headers);
  const viaServe = Boolean(first(headers['x-forwarded-for']));

  // Not proxied ⇒ it came straight to loopback, which only an on-host process can do.
  if (!viaServe) return { allow: true, reason: 'on_host' };

  if (!identity.present) {
    if (!opts.enforce) return { allow: true, reason: 'enforcement_disabled' };
    return { allow: false, reason: 'tagged_node_without_user' };
  }

  const login = identity.login!;
  const allowed = opts.allowedLogins ?? [];
  if (allowed.length > 0 && !allowed.some((l) => l.toLowerCase() === login.toLowerCase())) {
    if (!opts.enforce) return { allow: true, reason: 'enforcement_disabled', login };
    return { allow: false, reason: 'user_not_allowed', login };
  }
  return { allow: true, reason: 'tailnet_user', login };
}

/**
 * Paths that stay reachable without a user identity.
 *
 * Health is here deliberately: it carries no data, and fleet monitoring may call
 * it from another node. whoami is here because it is the tool for diagnosing a
 * refusal — locking it behind the rule it explains would be self-defeating.
 */
export const IDENTITY_EXEMPT_PATHS: readonly string[] = ['/health', '/api/identity/whoami'];
