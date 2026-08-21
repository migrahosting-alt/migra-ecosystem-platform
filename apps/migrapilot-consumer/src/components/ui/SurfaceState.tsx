import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The two honest ways a surface can have nothing to show — and they are NOT the same.
 *
 * `EmptyState`     a real backend answered, and the answer is "none yet".
 * `NotBuiltState`  there is no backend at all, so nothing can be shown or done here.
 *
 * Collapsing them is how a product lies quietly. "You have no projects" invites the user
 * to make one; if the create button then does nothing, the app has wasted their time and
 * spent its credibility. Saying "this isn't built yet" costs nothing and is true.
 *
 * These live here rather than in each screen so unbacked surfaces cannot drift into
 * inventing their own reassuring phrasing — the same reason `server/brain/view.ts` owns
 * the five Brain states centrally.
 */
function Frame({
  icon,
  title,
  children,
  tone,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  tone: 'slate' | 'amber'
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-2xl border border-dashed px-6 py-12 text-center',
        tone === 'amber' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-slate-50/50',
      )}
    >
      <span
        className={cn(
          'mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full',
          tone === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500',
        )}
      >
        {icon}
      </span>
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-slate-800">{title}</h2>
      <div className="mt-1.5 max-w-[46ch] text-[14px] leading-relaxed text-slate-500">{children}</div>
    </div>
  )
}

/** A real source answered, and the user genuinely has none of these yet. */
export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <Frame icon={icon} title={title} tone="slate">
      {children}
    </Frame>
  )
}

/**
 * No backend exists for this surface.
 *
 * `reason` is required on purpose: an unbuilt surface must say what is missing, so the
 * page cannot degrade into a decorative shrug that reads like an empty account.
 */
export function NotBuiltState({
  icon,
  title,
  reason,
}: {
  icon: ReactNode
  title: string
  reason: ReactNode
}) {
  return (
    <Frame icon={icon} title={title} tone="amber">
      {reason}
    </Frame>
  )
}
