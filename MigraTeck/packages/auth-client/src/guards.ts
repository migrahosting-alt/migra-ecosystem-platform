import { redirect } from "next/navigation";
import { getAppSession } from "./session";

export async function requireAuth() {
  const session = await getAppSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function requirePermission(permission: string) {
  const session = await requireAuth();

  if (!session.permissions.includes(permission)) {
    redirect("/unauthorized");
  }

  return session;
}

export async function requireAnyPermission(permissions: string[]) {
  const session = await requireAuth();
  const allowed = permissions.some((permission) => session.permissions.includes(permission));

  if (!allowed) {
    redirect("/unauthorized");
  }

  return session;
}
