import { siteUrl } from "@/lib/metadata";

export type AccountLinks = {
  origin: string | null;
  login: string;
  signup: string;
  forgotPassword: string;
  sessions: string;
};

function normalizeOrigin(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function toHref(origin: string | null, path: `/${string}`): string {
  if (!origin) {
    return path;
  }

  const target = new URL(path, origin);
  const currentSiteOrigin = new URL(siteUrl).origin;

  if (target.origin === currentSiteOrigin) {
    return `${target.pathname}${target.search}${target.hash}`;
  }

  return target.toString();
}

export function getAccountLinks(): AccountLinks {
  const origin = normalizeOrigin(
    process.env.ACCOUNT_URL
      ?? process.env.AUTH_WEB_URL
      ?? process.env.NEXT_PUBLIC_ACCOUNT_URL
      ?? process.env.NEXT_PUBLIC_AUTH_WEB_URL
      ?? process.env.NEXT_PUBLIC_AUTH_URL,
  );

  return {
    origin,
    login: toHref(origin, "/login"),
    signup: toHref(origin, "/signup"),
    forgotPassword: toHref(origin, "/forgot-password"),
    sessions: toHref(origin, "/sessions"),
  };
}