"use client";

import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/ui/button";
import { clearAccessToken } from "@/lib/auth/client-token";

export function LogoutButton() {
  const router = useRouter();

  return (
    <ActionButton
      variant="secondary"
      onClick={async () => {
        clearAccessToken();
        const response = await fetch("/api/auth/logout", {
          method: "POST",
        }).catch(() => null);

        const payload = response
          ? (await response.json().catch(() => null)) as { redirectTo?: string } | null
          : null;

        if (payload?.redirectTo) {
          window.location.href = payload.redirectTo;
          return;
        }

        router.push("/login");
        router.refresh();
      }}
    >
      Sign out
    </ActionButton>
  );
}
