import { cn } from '@/lib/cn'

const palettes = [
  'bg-blue-500',
  'bg-red-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-orange-500',
  'bg-cyan-600',
]

const sizes = {
  sm: 'h-7 w-7 rounded-md text-[11px]',
  md: 'h-9 w-9 rounded-lg text-sm',
}

/**
 * Stand-in favicon for a cited domain: the initial on a tint derived from the
 * hostname, so each source keeps a stable identity without fetching anything.
 */
export function SourceIcon({
  domain,
  size = 'sm',
  className,
}: {
  domain: string
  size?: keyof typeof sizes
  className?: string
}) {
  const host = domain.replace(/^www\./, '')
  let hash = 0
  for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) % 9973

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-bold text-white uppercase',
        palettes[hash % palettes.length],
        sizes[size],
        className,
      )}
    >
      {host[0]}
    </span>
  )
}
