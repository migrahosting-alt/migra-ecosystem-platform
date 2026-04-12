import { OrgRole } from "@prisma/client";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      defaultOrgId?: string | null;
      emailVerified: boolean;
      organizations: {
        id: string;
        name: string;
        slug: string;
        role: OrgRole;
        isMigraHostingClient: boolean;
      }[];
    } & DefaultSession["user"];
  }

  interface User {
    defaultOrgId?: string | null;
  }
}
