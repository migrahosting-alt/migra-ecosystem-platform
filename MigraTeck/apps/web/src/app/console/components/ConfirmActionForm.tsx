"use client";

import { useState, type ReactNode } from "react";
import { SubmitButton } from "./SubmitButton";

type Tone = "warn" | "bad" | "ok" | "accent";

/**
 * ConfirmActionForm — wraps a server action with a typed-confirmation modal
 * plus an optional reason field. Designed for destructive lifecycle actions
 * (Cancel client, Cancel subscription, Suspend, etc).
 *
 * Usage:
 *   <ConfirmActionForm
 *     action={cancelClient}
 *     hidden={{ id: tenantId }}
 *     trigger={{ label: "Cancel client", icon: <XCircle/>, tone: "bad" }}
 *     title="Cancel this client?"
 *     description="..."
 *     confirmPhrase={tenantName}          // type this to enable submit
 *     reasonRequired
 *   />
 */
export const ConfirmActionForm = ({
  action,
  hidden,
  trigger,
  title,
  description,
  confirmPhrase,
  confirmHint,
  reasonRequired = false,
  reasonLabel = "Reason (optional)",
  reasonPlaceholder = "Why are you doing this? Stored on the audit log.",
  submitLabel = "Confirm",
  submitTone = "bad",
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: (formData: FormData) => Promise<any> | void;
  hidden?: Record<string, string>;
  trigger: { label: ReactNode; icon?: ReactNode; tone: Tone; size?: "sm" | "md"; className?: string };
  title: string;
  description?: ReactNode;
  confirmPhrase?: string;
  confirmHint?: string;
  reasonRequired?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  submitLabel?: ReactNode;
  submitTone?: Tone;
}) => {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");

  const reasonOk = !reasonRequired || reason.trim().length >= 3;
  const phraseOk = !confirmPhrase || typed.trim() === confirmPhrase.trim();
  const canSubmit = reasonOk && phraseOk;

  const sizeCls = trigger.size === "sm" ? "px-2 py-1 text-[10px]" : "px-3 py-2 text-xs";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex w-full items-center justify-center gap-1.5 rounded-md border font-medium transition ${triggerToneClass(trigger.tone)} ${sizeCls} ${trigger.className || ""}`}
      >
        {trigger.icon}
        {trigger.label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/95 p-6 shadow-2xl shadow-rose-500/10"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-white">{title}</h3>
            {description && (
              <div className="mt-2 text-xs text-slate-400">{description}</div>
            )}

            <form action={action} className="mt-4 space-y-3">
              {hidden &&
                Object.entries(hidden).map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}

              {confirmPhrase && (
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-300">
                    Type{" "}
                    <span className="font-mono text-rose-300">{confirmPhrase}</span>{" "}
                    to confirm
                  </label>
                  <input
                    type="text"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoFocus
                    autoComplete="off"
                    className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-rose-400/40 focus:outline-none focus:ring-2 focus:ring-rose-400/20"
                  />
                  {confirmHint && (
                    <p className="mt-1 text-[10px] text-slate-500">{confirmHint}</p>
                  )}
                </div>
              )}

              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-300">
                  {reasonLabel}
                  {reasonRequired && <span className="ml-1 text-rose-400">*</span>}
                </label>
                <textarea
                  name="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder={reasonPlaceholder}
                  required={reasonRequired}
                  className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-fuchsia-400/40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10"
                >
                  Cancel
                </button>
                <ConfirmSubmit disabled={!canSubmit} tone={submitTone} label={submitLabel} />
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

const ConfirmSubmit = ({
  disabled,
  tone,
  label,
}: {
  disabled: boolean;
  tone: Tone;
  label: ReactNode;
}) => {
  if (disabled) {
    return (
      <button
        type="submit"
        disabled
        className={`rounded-md border px-4 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${triggerToneClass(tone)}`}
      >
        {label}
      </button>
    );
  }
  return (
    <SubmitButton tone={tone === "bad" ? "bad" : tone === "warn" ? "warn" : tone === "ok" ? "ok" : "accent"}>
      {label}
    </SubmitButton>
  );
};

const triggerToneClass = (t: Tone): string => {
  switch (t) {
    case "ok":
      return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20";
    case "warn":
      return "border-amber-400/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20";
    case "bad":
      return "border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20";
    case "accent":
      return "border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/20";
  }
};
