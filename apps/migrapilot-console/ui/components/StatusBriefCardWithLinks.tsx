"use client";

import { StatusBriefCard } from "@/ui/components/StatusBriefCard";
import type { PrimaryAction, StatusBriefCardProps } from "@/lib/ui-contracts";

type LinkAction = Omit<PrimaryAction, "onClick"> & {
  href: string;
};

type StatusBriefCardWithLinksProps = Omit<StatusBriefCardProps, "actions"> & {
  actions: LinkAction[];
};

export function StatusBriefCardWithLinks({
  actions,
  ...props
}: StatusBriefCardWithLinksProps) {
  const hydratedActions: PrimaryAction[] = actions.map((action) => ({
    ...action,
    onClick: () => {
      window.location.href = action.href;
    },
  }));

  return <StatusBriefCard {...props} actions={hydratedActions} />;
}
