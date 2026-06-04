/**
 * Small inline form helper used in tables / cards for single-action submits
 * (toggle, save, delete). Wraps a <form> with action; renders nothing visible
 * beyond what you pass in children.
 */
import type { ReactNode } from "react";

export const InlineForm = ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action,
  children,
  className = "",
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: (formData: FormData) => Promise<any> | void;
  children: ReactNode;
  className?: string;
}) => (
  <form action={action} className={className}>
    {children}
  </form>
);

export const DeleteButton = ({ label = "Delete" }: { label?: string }) => (
  <button
    type="submit"
    className="rounded-md border border-rose-400/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-medium text-rose-200 transition hover:bg-rose-500/20"
  >
    {label}
  </button>
);

export const PrimaryButton = ({ label = "Save" }: { label?: string }) => (
  <button
    type="submit"
    className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-3 py-1 text-[10px] font-semibold text-white shadow-md shadow-fuchsia-500/30 transition hover:shadow-fuchsia-500/50"
  >
    {label}
  </button>
);

export const Toggle = ({ checked, name }: { checked: boolean; name: string }) => (
  <label className="relative inline-flex h-5 w-9 cursor-pointer items-center">
    <input type="checkbox" name={name} defaultChecked={checked} className="peer sr-only" />
    <span className="absolute inset-0 rounded-full bg-slate-700 transition peer-checked:bg-emerald-500" />
    <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-4" />
  </label>
);
