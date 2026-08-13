import { cn } from '@/lib/cn'

/**
 * The MP monogram: a blue sphere with a white "MP" and a small prismatic
 * refraction under the M, matching the mark used across the mockups.
 */
export function LogoMark({ className, id = 'mp' }: { className?: string; id?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-9 w-9', className)} role="img" aria-label="MigraPilot">
      <defs>
        <linearGradient id={`${id}-sphere`} x1="8%" y1="0%" x2="92%" y2="100%">
          <stop offset="0%" stopColor="#7dd3fc" />
          <stop offset="30%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id={`${id}-prism`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#fb7185" />
          <stop offset="45%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
        <radialGradient id={`${id}-gloss`} cx="30%" cy="22%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${id}-clip)`}>
        <circle cx="32" cy="32" r="32" fill={`url(#${id}-sphere)`} />
        <circle cx="32" cy="32" r="32" fill={`url(#${id}-gloss)`} />
        {/* prismatic refraction, mostly tucked under the letterforms */}
        <path d="M23 44h22l-7 7H16z" fill={`url(#${id}-prism)`} />
        {/* M */}
        <path d="M9 46V18h5.8l7.7 11.8L30.2 18H36v28h-5.9V29.3l-6.3 9.5h-1.6l-6.3-9.5V46z" fill="#fff" />
        {/* P — counter is punched out with the even-odd rule */}
        <path
          fillRule="evenodd"
          d="M39 46V18h9.2a9 9 0 0 1 0 18h-3.3v10zm5.9-15.6h3.3a3.4 3.4 0 0 0 0-6.8h-3.3z"
          fill="#fff"
        />
      </g>
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-[22px] font-bold tracking-[-0.02em] text-slate-900">MigraPilot</span>
    </span>
  )
}
