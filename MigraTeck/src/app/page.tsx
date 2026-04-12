import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getAuthSession();
  redirect(session?.user?.id ? "/app" : "/login");
}
