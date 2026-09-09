'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/cn'
import { MAIL_OUTCOME_PARAM, mailOutcomeNotice } from './connectionOutcome'

/**
 * The result of coming back from a consent screen.
 *
 * 🚨 THE PARAMETER IS CLEARED ONCE READ.
 *
 * Left in the URL it would re-announce "Your email is connected" on every
 * refresh and on every link the user shares from that page — a stale claim
 * about someone else's account, in the second case. `router.replace` also keeps
 * it out of the back-stack, so Back does not walk into the announcement again.
 *
 * Mounted app-wide because the callback lands the user wherever they started,
 * which is deliberately not a single page.
 */
export function MailConnectionNotice() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const token = params.get(MAIL_OUTCOME_PARAM)
  const [dismissed, setDismissed] = useState(false)
  const notice = mailOutcomeNotice(token)

  useEffect(() => {
    if (!token) return
    /*
     * Cleared whether or not it was recognised. An unknown value renders
     * nothing, and leaving it in the URL would keep it in shared links for no
     * reason.
     */
    const next = new URLSearchParams(params.toString())
    next.delete(MAIL_OUTCOME_PARAM)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [token, params, pathname, router])

  if (!notice || dismissed) return null

  return (
    <div
      role="status"
      className={cn(
        'mx-auto mb-2 mt-2 flex w-full max-w-3xl items-start justify-between gap-3 rounded-lg border px-3 py-2 text-[13px]',
        notice.tone === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-amber-200 bg-amber-50 text-amber-900',
      )}
    >
      <span>{notice.message}</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className={cn(
          'shrink-0 font-medium',
          notice.tone === 'success' ? 'text-emerald-700 hover:text-emerald-900' : 'text-amber-700 hover:text-amber-900',
        )}
      >
        Dismiss
      </button>
    </div>
  )
}
