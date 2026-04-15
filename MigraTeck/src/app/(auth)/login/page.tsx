import { MigraHostingLoginCard } from "@/components/auth/migrahosting-login-card";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const nextParam = typeof resolvedSearchParams.next === "string" ? resolvedSearchParams.next : null;
  const continueHref = nextParam
    ? `/api/auth/start?next=${encodeURIComponent(nextParam)}`
    : "/api/auth/start";

  return (
    <MigraHostingLoginCard
      continueHref={continueHref}
      signupHref="/signup"
      forgotPasswordHref="/forgot-password"
    />
  );
}
