import { redirect } from "next/navigation";

export default function MigraDriveOpsIndexPage() {
  redirect("/app/platform/migradrive/tenants");
}