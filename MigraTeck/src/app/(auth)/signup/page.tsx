import { MigraHostingSignupCard } from "@/components/auth/migrahosting-signup-card";

export default function SignupPage() {
  return <MigraHostingSignupCard continueHref="/api/auth/signup" loginHref="/login" />;
}
