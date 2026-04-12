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
        await fetch("/api/auth/logout", {
          method: "POST",
        }).catch(() => undefined);
        router.push("/login");
        router.refresh();
      }}
    >
      Sign out
    </ActionButton>
  );
}
