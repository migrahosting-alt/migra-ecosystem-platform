"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, ShieldX, RotateCcw, LogOut, Smartphone } from "lucide-react";

import { suspendUserAction, banUserAction, restoreUserAction } from "./actions";

type Kind = "suspend" | "ban" | "restore";

const TIP = "Session/device controls require a backend endpoint (planned).";

/** Disabled placeholder for not-yet-built controls (force logout / device revoke). */
const Disabled = ({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) => (
  <span title={`${label} — coming soon. ${TIP}`} className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-[11px] font-medium text-slate-600 opacity-70">
    <Icon className="h-3.5 w-3.5" /> {label}
  </span>
);

const ACTION_META: Record<Kind, { label: string; verb: string; toClass: string; danger: boolean }> = {
  suspend: { label: "Suspend", verb: "suspend", toClass: "border-amber-400/30 bg-amber-500/15 text-amber-200", danger: false },
  ban: { label: "Ban", verb: "ban", toClass: "border-rose-400/30 bg-rose-500/15 text-rose-200", danger: true },
  restore: { label: "Restore", verb: "restore", toClass: "border-emerald-400/30 bg-emerald-500/15 text-emerald-200", danger: false },
};

export function UserAccountActions({
  userId,
  status,
  maskedName,
  canSuspend,
  canBan,
  canRestore,
}: {
  userId: string;
  status: string;
  /** Already masked on the server — never a raw phone. */
  maskedName: string;
  canSuspend: boolean;
  canBan: boolean;
  canRestore: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const showSuspend = canSuspend && status === "active";
  const showBan = canBan && status !== "banned";
  const showRestore = canRestore && status !== "active";

  const open = (k: Kind) => { setKind(k); setReason(""); setError(null); };
  const close = () => { if (!pending) setKind(null); };

  const submit = () => {
    if (!kind) return;
    const r = reason.trim();
    if (!r) { setError("A reason is required."); return; }
    setError(null);
    startTransition(async () => {
      const fn = kind === "suspend" ? suspendUserAction : kind === "ban" ? banUserAction : restoreUserAction;
      const res = await fn(userId, r);
      if (res.ok) {
        setKind(null);
        router.refresh();
      } else {
        setError(res.error ?? "Action failed.");
      }
    });
  };

  const meta = kind ? ACTION_META[kind] : null;
  const newStatus = kind === "suspend" ? "suspended" : kind === "ban" ? "banned" : "active";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showSuspend && (
        <button type="button" onClick={() => open("suspend")} className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-200 transition hover:bg-amber-500/20">
          <ShieldX className="h-3.5 w-3.5" /> Suspend
        </button>
      )}
      {showBan && (
        <button type="button" onClick={() => open("ban")} className="inline-flex items-center gap-1 rounded-md border border-rose-400/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-medium text-rose-200 transition hover:bg-rose-500/20">
          <Ban className="h-3.5 w-3.5" /> Ban
        </button>
      )}
      {showRestore && (
        <button type="button" onClick={() => open("restore")} className="inline-flex items-center gap-1 rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-200 transition hover:bg-emerald-500/20">
          <RotateCcw className="h-3.5 w-3.5" /> Restore
        </button>
      )}

      {/* Not-yet-built controls */}
      <Disabled icon={LogOut} label="Force logout" />
      <Disabled icon={Smartphone} label="Device revoke" />

      {kind && meta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-white">{meta.label} this account?</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-400">
              You are about to <span className="font-semibold text-slate-200">{meta.verb}</span>{" "}
              <span className="font-medium text-slate-200">{maskedName}</span>{" "}
              (<span className="font-mono text-slate-500">{userId.slice(0, 8)}</span>).
              Status will change <span className="font-mono text-slate-400">{status}</span> →{" "}
              <span className="font-mono text-slate-200">{newStatus}</span>. This is audited.
            </p>
            {meta.danger && (
              <p className="mt-3 rounded-md border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
                Ban is a severe action: the account is blocked platform-wide until restored.
              </p>
            )}
            <label className="mt-4 block">
              <span className="text-[11px] font-medium text-slate-300">Reason <span className="text-rose-400">*</span></span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Required — recorded in the audit log."
                className="mt-1 w-full resize-none rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-slate-100 placeholder:text-slate-600 focus:border-fuchsia-400/40 focus:outline-none"
              />
              <span className="mt-0.5 block text-right text-[10px] text-slate-600">{reason.trim().length}/500</span>
            </label>
            {error && (
              <p className="mt-1 rounded-md border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300">{error}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={close} disabled={pending} className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-slate-300 transition hover:bg-white/10 disabled:opacity-50">
                Cancel
              </button>
              <button type="button" onClick={submit} disabled={pending || !reason.trim()} className={`rounded-md border px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-50 ${meta.toClass}`}>
                {pending ? "Working…" : `${meta.label} account`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
