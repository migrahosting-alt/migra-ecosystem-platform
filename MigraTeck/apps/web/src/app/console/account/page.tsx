import { redirect } from "next/navigation";
import Link from "next/link";
import { LogOut, Key, ShieldCheck, Mail } from "lucide-react";

import { getSession } from "../lib/auth";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const issued = new Date(session.iat * 1000);
  const expires = new Date(session.exp * 1000);

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/account"
      title="My Account"
      subtitle="Profile, session, and security for the signed-in administrator."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard className="lg:col-span-1" title="Profile">
          <div className="flex flex-col items-center gap-3 py-2">
            <span className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500 text-xl font-black text-white shadow-lg shadow-purple-900/40">
              {session.email
                .split("@")[0]!
                .split(/[._-]/)
                .map((p) => p[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <div className="text-center">
              <p className="text-sm font-semibold text-white">{session.email.split("@")[0]}</p>
              <p className="text-xs text-slate-400">{session.email}</p>
              <p className="mt-1 text-[10px] uppercase tracking-wider text-fuchsia-300">Administrator</p>
            </div>
          </div>
          <a
            href="/console/api/logout"
            className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-xs font-medium text-rose-200 transition hover:bg-rose-500/20"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </a>
        </SectionCard>

        <SectionCard className="lg:col-span-2" title="Session">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Signed in at</p>
              <p className="mt-1 text-sm text-white">{issued.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Session expires</p>
              <p className="mt-1 text-sm text-white">{expires.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Session length</p>
              <p className="mt-1 text-sm text-white">12 hours</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Auth scheme</p>
              <p className="mt-1 text-sm text-white">HMAC-SHA256 signed cookie</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard className="lg:col-span-3" title="Security">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
              <div className="mb-2 flex items-center gap-2">
                <Key className="h-4 w-4 text-fuchsia-300" />
                <span className="text-xs font-semibold text-white">Change password</span>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-400">
                The admin password is stored as a scrypt hash in <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-[10px] text-slate-300">/etc/migrateck/console.env</code> on app-core. To rotate it, SSH into app-core and run:
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-950/80 p-3 text-[10px] leading-relaxed text-slate-300">
{`# Generate a new hash (replace NEW_PASSWORD)
node -e "const c=require('crypto');const s=c.randomBytes(16);const h=c.scryptSync('NEW_PASSWORD',s,64).toString('hex');console.log('scrypt:'+s.toString('hex')+':'+h)"

# Edit the env file, replace CONSOLE_ADMIN_PASSWORD_HASH=...
sudo nano /etc/migrateck/console.env

# Restart to load the new hash
sudo systemctl restart migrateck`}
              </pre>
            </div>

            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-300" />
                <span className="text-xs font-semibold text-white">Session security</span>
              </div>
              <ul className="space-y-1.5 text-[11px] text-slate-300">
                <li className="flex items-start gap-1.5">
                  <span className="text-emerald-400">✓</span>
                  HttpOnly cookie (not accessible to JavaScript)
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-emerald-400">✓</span>
                  Secure flag (HTTPS only)
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-emerald-400">✓</span>
                  SameSite=lax (CSRF protection)
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-emerald-400">✓</span>
                  HMAC-SHA256 signed payload
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-emerald-400">✓</span>
                  Auto-expires after 12 hours
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-emerald-400">✓</span>
                  Path scoped to /console
                </li>
              </ul>
            </div>
          </div>
        </SectionCard>

        <SectionCard className="lg:col-span-3" title="Quick links" subtitle="Common actions for administrators.">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <QuickLink href="/console/settings" label="System settings" icon={ShieldCheck} />
            <QuickLink href="/console/team" label="Team members" icon={Mail} />
            <QuickLink href="/console/security" label="Security audit" icon={ShieldCheck} />
            <QuickLink href="/console" label="Back to overview" icon={Key} />
          </div>
        </SectionCard>
      </div>
    </ConsolePageShell>
  );
}

const QuickLink = ({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) => (
  <Link
    href={href}
    className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-slate-300 transition hover:border-white/15 hover:bg-white/[0.04] hover:text-white"
  >
    <Icon className="h-3.5 w-3.5 text-fuchsia-300" />
    {label}
  </Link>
);
