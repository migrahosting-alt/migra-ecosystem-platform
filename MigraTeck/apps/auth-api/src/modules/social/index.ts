/**
 * Turning a provider profile into a canonical MigraAuth user.
 *
 * The DECISION lives in `linking.ts` and is pure; this file gathers the facts it
 * needs and carries out whatever it returns. Keeping those apart is what makes
 * the dangerous cases — link to the wrong account, create a duplicate, move
 * someone else's provider account — testable as a table instead of reachable
 * only through a live OAuth round trip.
 *
 * NOTHING HERE CREATES A SECOND KIND OF USER. A provider sign-in produces the
 * same `users` row a password signup produces, so sessions, OIDC subjects, org
 * membership and billing are all untouched by this feature existing.
 */

import { db } from "../../lib/db.js";
import { decideLinking, type LinkingDecision, type LinkMode } from "./linking.js";
import type { ExternalProfile } from "./providers.js";
import type { IdentityProvider, User } from "../../prisma-client.js";

export interface ResolveInput {
  provider: IdentityProvider;
  profile: ExternalProfile;
  mode: LinkMode;
  sessionUserId: string | null;
}

export type ResolveOutcome =
  | { ok: true; user: User; decision: LinkingDecision; created: boolean; linked: boolean }
  | { ok: false; code: string; message: string };

/** Normalized for comparison exactly as the identifier module normalizes email. */
const normalizeEmail = (email: string | null): string | null =>
  email ? email.trim().toLowerCase() || null : null;

export async function resolveProviderSignIn(input: ResolveInput): Promise<ResolveOutcome> {
  const email = normalizeEmail(input.profile.email);

  const existingLink = await db.userLinkedIdentity.findUnique({
    where: {
      provider_providerAccountId: {
        provider: input.provider,
        providerAccountId: input.profile.providerAccountId,
      },
    },
  });

  /*
   * The address is looked up through `user_identifiers`, not `users.email`.
   *
   * That table is where verification state actually lives, and the linking rule
   * turns on whether MigraAuth itself verified the address — a `users.email`
   * match would tell us an account claims it, not that anyone proved it.
   */
  const emailIdentifier = email
    ? await db.userIdentifier.findUnique({
        where: { kind_normalizedValue: { kind: "EMAIL", normalizedValue: email } },
        include: { user: true },
      })
    : null;

  const sessionUserLink =
    input.sessionUserId !== null
      ? await db.userLinkedIdentity.findUnique({
          where: { userId_provider: { userId: input.sessionUserId, provider: input.provider } },
        })
      : null;

  const decision = decideLinking({
    mode: input.mode,
    existingLinkUserId: existingLink?.userId ?? null,
    providerEmail: email,
    providerEmailVerified: input.profile.emailVerified,
    emailOwnerUserId: emailIdentifier?.userId ?? null,
    emailOwnerVerified: emailIdentifier?.isVerified === true,
    sessionUserId: input.sessionUserId,
    sessionUserAlreadyLinkedProvider: sessionUserLink !== null,
  });

  if (decision.kind === "refuse") {
    return { ok: false, code: decision.code, message: decision.message };
  }

  if (decision.kind === "sign_in") {
    const user = await db.user.findUnique({ where: { id: decision.userId } });
    if (!user) {
      // The link outlived its user. Refusing beats resurrecting an account.
      return { ok: false, code: "account_unavailable", message: "That account is no longer available." };
    }
    const blocked = refuseBlockedAccount(user);
    if (blocked) return blocked;

    await touchLink(input, decision.userId);
    return { ok: true, user, decision, created: false, linked: false };
  }

  if (decision.kind === "link_and_sign_in" || decision.kind === "link_to_session") {
    const user = await db.user.findUnique({ where: { id: decision.userId } });
    if (!user) {
      return { ok: false, code: "account_unavailable", message: "That account is no longer available." };
    }
    const blocked = refuseBlockedAccount(user);
    if (blocked) return blocked;

    await attachLink(input, decision.userId);
    return { ok: true, user, decision, created: false, linked: true };
  }

  const user = await createUserFromProfile(input);
  return { ok: true, user, decision, created: true, linked: true };
}

/** A locked or disabled account is not a sign-in route, whatever proved it. */
function refuseBlockedAccount(user: User): { ok: false; code: string; message: string } | null {
  if (user.status === "LOCKED") {
    return { ok: false, code: "account_locked", message: "Account is locked. Reset your password or try again later." };
  }
  if (user.status === "DISABLED") {
    return { ok: false, code: "account_disabled", message: "Account has been disabled." };
  }
  if (user.deletedAt) {
    return { ok: false, code: "account_unavailable", message: "That account is no longer available." };
  }
  return null;
}

async function touchLink(input: ResolveInput, userId: string): Promise<void> {
  await db.userLinkedIdentity.update({
    where: {
      provider_providerAccountId: {
        provider: input.provider,
        providerAccountId: input.profile.providerAccountId,
      },
    },
    data: {
      lastUsedAt: new Date(),
      // The provider's own profile is refreshed on every use: an address or a
      // display name that changed there should not stay frozen here.
      email: normalizeEmail(input.profile.email),
      emailVerified: input.profile.emailVerified,
      displayName: input.profile.displayName,
      avatarUrl: input.profile.avatarUrl,
      userId,
    },
  });
}

async function attachLink(input: ResolveInput, userId: string): Promise<void> {
  const data = {
    email: normalizeEmail(input.profile.email),
    emailVerified: input.profile.emailVerified,
    displayName: input.profile.displayName,
    avatarUrl: input.profile.avatarUrl,
    lastUsedAt: new Date(),
  };

  /*
   * Upsert on the PROVIDER ACCOUNT, not on the user.
   *
   * The unique index this targets is what enforces "one external account, one
   * MigraAuth user" at the database rather than in a check that a concurrent
   * request could interleave with. Two simultaneous first-time links for the
   * same provider account resolve to one row either way.
   */
  await db.userLinkedIdentity.upsert({
    where: {
      provider_providerAccountId: {
        provider: input.provider,
        providerAccountId: input.profile.providerAccountId,
      },
    },
    create: {
      userId,
      provider: input.provider,
      providerAccountId: input.profile.providerAccountId,
      ...data,
    },
    update: { ...data, userId },
  });
}

/**
 * A brand-new account, from a provider profile alone.
 *
 * ACTIVE and email-verified ONLY when the provider verified the address. A
 * provider that will not vouch for an address leaves the account exactly where a
 * password signup would leave it — pending, unverified — rather than being
 * promoted on the strength of having arrived through a recognisable logo.
 *
 * NO PASSWORD CREDENTIAL is written. The account has one way in until its owner
 * deliberately adds another, and inventing an unusable password row would leave
 * something for a future bug to authenticate against.
 */
async function createUserFromProfile(input: ResolveInput): Promise<User> {
  const email = normalizeEmail(input.profile.email);
  const verified = email !== null && input.profile.emailVerified;
  const now = new Date();

  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        displayName: input.profile.displayName,
        avatarUrl: input.profile.avatarUrl,
        status: verified ? "ACTIVE" : "PENDING",
        emailVerifiedAt: verified ? now : null,
      },
    });

    if (email) {
      await tx.userIdentifier.create({
        data: {
          userId: user.id,
          kind: "EMAIL",
          normalizedValue: email,
          displayValue: input.profile.email,
          isPrimary: true,
          isVerified: verified,
          verifiedAt: verified ? now : null,
        },
      });
    }

    await tx.userLinkedIdentity.create({
      data: {
        userId: user.id,
        provider: input.provider,
        providerAccountId: input.profile.providerAccountId,
        email,
        emailVerified: input.profile.emailVerified,
        displayName: input.profile.displayName,
        avatarUrl: input.profile.avatarUrl,
        lastUsedAt: now,
      },
    });

    return user;
  });
}

/** Providers attached to an account, for settings and for the unlink guard. */
export async function listLinkedIdentities(userId: string) {
  return db.userLinkedIdentity.findMany({
    where: { userId },
    orderBy: { linkedAt: "asc" },
  });
}

export type UnlinkOutcome = { ok: true } | { ok: false; code: string; message: string };

/**
 * Detach a provider — unless it is the only way in.
 *
 * THE SAFEGUARD IS THE POINT. An account created through Google has no password
 * and, quite possibly, no verified address it could reset one against.
 * Unlinking its single provider would lock its owner out permanently, with the
 * button that did it looking exactly like a preference.
 */
export async function unlinkProvider(input: {
  userId: string;
  provider: IdentityProvider;
}): Promise<UnlinkOutcome> {
  const [links, passwordCredential] = await Promise.all([
    db.userLinkedIdentity.findMany({ where: { userId: input.userId } }),
    db.userCredential.findFirst({
      where: { userId: input.userId, type: "PASSWORD", isEnabled: true },
    }),
  ]);

  const target = links.find((link) => link.provider === input.provider);
  if (!target) {
    return { ok: false, code: "not_linked", message: "That provider is not linked to your account." };
  }

  const otherWaysIn = links.length - 1 + (passwordCredential ? 1 : 0);
  if (otherWaysIn <= 0) {
    return {
      ok: false,
      code: "last_sign_in_method",
      message:
        "This is the only way to sign in to your account. Set a password first, then unlink this provider.",
    };
  }

  await db.userLinkedIdentity.delete({ where: { id: target.id } });
  return { ok: true };
}
