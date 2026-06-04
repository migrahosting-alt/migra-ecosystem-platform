import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export const FormShell = ({
  backHref,
  backLabel = "Back",
  title,
  description,
  error,
  notice,
  action,
  submitLabel = "Create",
  children,
}: {
  backHref: string;
  backLabel?: string;
  title: string;
  description?: string;
  error?: string | null;
  notice?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: (formData: FormData) => Promise<any> | void;
  submitLabel?: string;
  children: ReactNode;
}) => {
  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link
        href={backHref}
        className="mb-4 inline-flex items-center gap-1 text-xs text-slate-400 transition hover:text-fuchsia-300"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        {backLabel}
      </Link>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 shadow-xl shadow-slate-950/30 backdrop-blur">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {description && <p className="mt-1 text-xs text-slate-400">{description}</p>}
        {error && (
          <div className="mt-4 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-200">
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            {notice}
          </div>
        )}
        <form action={action} className="mt-5 space-y-4">
          {children}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Link
              href={backHref}
              className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="rounded-md bg-gradient-to-r from-fuchsia-500 to-pink-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-fuchsia-500/30 transition hover:shadow-fuchsia-500/50"
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const Field = ({
  label,
  name,
  type = "text",
  required = false,
  placeholder,
  defaultValue,
  hint,
  options,
}: {
  label: string;
  name: string;
  type?: "text" | "email" | "number" | "select" | "textarea";
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  hint?: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
}) => {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-[11px] font-medium text-slate-300">
        {label}
        {required && <span className="ml-1 text-rose-400">*</span>}
      </label>
      {type === "textarea" ? (
        <textarea
          id={name}
          name={name}
          required={required}
          placeholder={placeholder}
          defaultValue={defaultValue}
          rows={4}
          className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-fuchsia-400/40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20"
        />
      ) : type === "select" && options ? (
        <select
          id={name}
          name={name}
          required={required}
          defaultValue={defaultValue}
          className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-fuchsia-400/40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-slate-900">
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={name}
          name={name}
          type={type}
          required={required}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-fuchsia-400/40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20"
        />
      )}
      {hint && <p className="mt-1 text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
};
