import { getAuthSession } from "@/lib/auth/session";

export async function auth() {
  return getAuthSession();
}
