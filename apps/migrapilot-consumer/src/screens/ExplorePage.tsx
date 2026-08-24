'use client'

import { Compass } from 'lucide-react'

import { Workspace } from '@/components/layout/AppShell'

/**
 * Explore is NOT built yet.
 *
 * This page previously rendered a fully fabricated research answer — a
 * SharePoint-migration write-up with numbered citations to Microsoft Learn,
 * Microsoft 365 Admin Center and AvePoint, under the claim "Answers are
 * grounded in trusted sources". None of it came from a model, and the site is
 * public, so it was inventing citations to real companies for real visitors.
 *
 * It is replaced with an honest unavailable state rather than deleted, because
 * the route still exists and a visitor who reaches it deserves the truth. The
 * real implementation belongs to the Explore module, which will render only
 * sources actually returned with an answer. Do not restore the mock.
 */
export function ExplorePage() {
  return (
    <Workspace contentClassName="mx-auto w-full max-w-[640px] px-6 py-16 sm:px-8">
      <div className="flex flex-col items-center text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          <Compass className="h-7 w-7" strokeWidth={1.8} />
        </span>
        <h1 className="mt-6 text-[26px] font-bold tracking-[-0.02em] text-slate-900">
          Explore isn&rsquo;t available yet
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
          Grounded research with cited sources is still being built. When it ships, it will show
          only sources that were actually used to produce an answer.
        </p>
        <p className="mt-6 text-[15px] leading-relaxed text-slate-600">
          In the meantime, you can ask MigraPilot anything from{' '}
          <a href="/" className="font-semibold text-brand-text hover:text-brand-text-hover">
            Chat
          </a>
          .
        </p>
      </div>
    </Workspace>
  )
}
