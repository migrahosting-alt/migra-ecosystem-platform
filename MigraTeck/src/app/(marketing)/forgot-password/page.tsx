import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { buildForgotPasswordUrl } from "@/lib/auth/migraauth";

export default async function ForgotPasswordPage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  redirect(buildForgotPasswordUrl({ host }));
}
