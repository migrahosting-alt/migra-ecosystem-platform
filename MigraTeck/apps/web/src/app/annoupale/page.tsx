import { redirect } from "next/navigation";

/**
 * Short alias: /annoupale → /console/annoupale.
 *
 * The AnnouPale Trust & Operations console lives under the authenticated
 * /console/* surface; this top-level alias just forwards there (the target
 * enforces the console session and redirects to /console/login if absent).
 */
export const dynamic = "force-dynamic";

export default function AnnoupaleAliasPage() {
  redirect("/console/annoupale");
}
