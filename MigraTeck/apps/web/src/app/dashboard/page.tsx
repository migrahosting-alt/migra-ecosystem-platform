import { requirePermission } from "@migrateck/auth-client";
import { redirect } from "next/navigation";
import { ensureAuthClientInitialized } from "@/lib/auth/init";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");
  redirect("/platform/overview");
}
