import { MigraHostingUnauthorizedCard } from "@/components/auth/migrahosting-unauthorized-card";

export default function UnauthorizedPage() {
  return <MigraHostingUnauthorizedCard dashboardHref="/app" loginHref="/login" />;
}
