import Image from 'next/image'

import { cn } from '@/lib/cn'
import logoSrc from '../../../public/brand/migrapilot-logo.png'

/**
 * The official MigraPilot mark.
 *
 * This renders the CANONICAL brand asset
 * (`Rebrand/Migra_official_logos/MigraPilot_official_logo.png`, trimmed and
 * padded to a square), not a redrawn approximation. An earlier version of this
 * file hand-built the monogram in SVG; it drifted from the real mark, so the
 * asset is now the single source of truth and must not be re-illustrated.
 *
 * The `id` prop is retained so existing call sites keep compiling — it was only
 * ever needed to namespace SVG gradient ids, which no longer exist.
 */
export function LogoMark({ className }: { className?: string; id?: string }) {
  return (
    <Image
      src={logoSrc}
      alt=""
      aria-hidden
      priority
      sizes="128px"
      className={cn('h-9 w-9 shrink-0 select-none', className)}
    />
  )
}

/**
 * Mark plus product name. The wordmark is the primary identifier, so the text
 * carries the weight and the mark sits beside it at matching optical size.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-[22px] font-bold tracking-[-0.02em] text-slate-900">MigraPilot</span>
    </span>
  )
}
