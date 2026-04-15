import { AdminLayout as AuthAdminLayout } from "@migrateck/auth-ui";
import { migraAuthBrand } from "@/lib/branding";

const navItems = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/clients", label: "OAuth Clients" },
  { href: "/admin/audit", label: "Audit explorer" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthAdminLayout
      theme={migraAuthBrand}
      navItems={navItems}
      rightRail={(
        <div className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-200">Operator rail</p>
            <h2 className="mt-2 text-lg font-semibold text-white">MigraAuth control plane</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Audit-backed admin surfaces for users, clients, and security activity across the platform.
            </p>
          </div>
          <div className="space-y-3 text-sm text-zinc-300">
            <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
              <p className="font-semibold text-white">Role enforcement</p>
              <p className="mt-1 text-zinc-400">Admin actions remain centralized and reviewable.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3">
              <p className="font-semibold text-white">Audit posture</p>
              <p className="mt-1 text-zinc-400">Identity, sessions, and OAuth events flow into one security surface.</p>
            </div>
          </div>
        </div>
      )}
    >
      {children}
    </AuthAdminLayout>
  );
}
