'use client'

import { usePathname } from 'next/navigation'
import { AlertCircle, Sparkles } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useAnonymousQuota } from './AnonymousQuotaProvider'

/**
 * What a signed-out visitor is told about their free messages.
 *
 * Three states, deliberately distinct because they need three different
 * reactions from the reader:
 *
 *   plenty     a quiet count. Present, not nagging.
 *   warning    the last couple of turns, coloured so it registers BEFORE the
 *              wall — being stopped mid-thought with no warning is the part
 *              people resent, not the limit itself.
 *   exhausted  a block with the two things that fix it, and the promise that
 *              the conversation survives signing in. That promise is real: the
 *              conversation id is preserved by the claim.
 *
 * A number is shown ONLY when the server supplied one. When the allowance could
 * not be read the count is omitted rather than guessed — an invented "5 left"
 * would promise turns the reservation will refuse, and an invented "0 left"
 * would block someone who has turns remaining.
 *
 * Both destinations are real routes: `/api/auth/login` and `/api/auth/signup`
 * each build a PKCE authorize URL through MigraAuth, and both come back through
 * the callback that claims this visitor's conversations.
 */
export function AnonymousQuotaNotice({ className }: { className?: string }) {
  const { mode, quota } = useAnonymousQuota()
  const pathname = usePathname()

  // A signed-in user has no allowance, and neither does a build where anonymous
  // chat is switched off. Neither should see anything at all.
  if (mode !== 'anonymous') return null

  const next = encodeURIComponent(pathname || '/')
  const signIn = `/api/auth/login?next=${next}`
  const createAccount = `/api/auth/signup?next=${next}`

  if (!quota) {
    return (
      <p
        className={cn('text-center text-[13px] text-slate-400', className)}
        data-testid="anon-quota-unknown"
      >
        You are chatting without an account.{' '}
        <a href={signIn} className="font-semibold text-brand-600 hover:underline">
          Sign in
        </a>{' '}
        to keep your conversations.
      </p>
    )
  }

  if (quota.exhausted) {
    return (
      <div
        data-testid="anon-quota-exhausted"
        className={cn(
          'rounded-2xl border border-brand-200 bg-brand-50/70 p-4 text-center sm:p-5',
          className,
        )}
      >
        <p className="text-[15px] font-semibold text-slate-900">
          You have used all {quota.limit} free messages
        </p>
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-slate-600">
          Sign in or create an account to keep going. This conversation comes with you — same
          thread, nothing lost.
        </p>
        <div className="mt-4 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
          <a
            href={createAccount}
            data-testid="anon-create-account"
            className="inline-flex w-full items-center justify-center rounded-field bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-brand transition-colors hover:bg-brand-700 sm:w-auto"
          >
            Create account
          </a>
          <a
            href={signIn}
            data-testid="anon-sign-in"
            className="inline-flex w-full items-center justify-center rounded-field border border-slate-300 bg-raised px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 sm:w-auto"
          >
            Sign in
          </a>
        </div>
      </div>
    )
  }

  const label = `${quota.remaining} of ${quota.limit} free ${quota.remaining === 1 ? 'message' : 'messages'} left`

  return (
    <div
      data-testid={quota.warning ? 'anon-quota-warning' : 'anon-quota'}
      data-remaining={quota.remaining}
      className={cn('flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px]', className)}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium',
          quota.warning ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500',
        )}
      >
        {quota.warning ? (
          <AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
        ) : (
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        {label}
      </span>
      <span className="text-slate-400">
        <a href={signIn} className="font-semibold text-brand-600 hover:underline">
          Sign in
        </a>{' '}
        for unlimited messages — this conversation comes with you.
      </span>
    </div>
  )
}
