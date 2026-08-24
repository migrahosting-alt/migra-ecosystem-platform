import { cn } from '@/lib/cn'

const palettes = [
  'from-blue-400 to-indigo-500',
  'from-emerald-400 to-teal-500',
  'from-amber-400 to-orange-500',
  'from-fuchsia-400 to-purple-500',
  'from-rose-400 to-pink-500',
  'from-cyan-400 to-sky-500',
]

function initials(name: string, count: number) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, count)
    .map((part) => part[0]!.toUpperCase())
    .join('')
}

function paletteFor(name: string) {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 9973
  return palettes[hash % palettes.length]!
}

const sizes = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-11 w-11 text-sm',
}

export function Avatar({
  name,
  size = 'md',
  className,
  ring,
  /** Stacked avatars overlap, so they show a single initial to stay legible. */
  initialsCount = 2,
}: {
  name: string
  size?: keyof typeof sizes
  className?: string
  ring?: boolean
  initialsCount?: number
}) {
  return (
    <span
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-linear-to-br font-semibold text-white select-none',
        paletteFor(name),
        sizes[size],
        ring && 'ring-2 ring-canvas',
        className,
      )}
    >
      {initials(name, initialsCount)}
    </span>
  )
}

/** Overlapping avatar row with a "+N" overflow chip. */
export function AvatarStack({
  names,
  max = 3,
  size = 'sm',
}: {
  names: string[]
  max?: number
  size?: keyof typeof sizes
}) {
  const shown = names.slice(0, max)
  const overflow = names.length - shown.length
  return (
    <div className="flex items-center">
      <div className="flex -space-x-1.5">
        {shown.map((name) => (
          <Avatar key={name} name={name} size={size} ring initialsCount={1} />
        ))}
      </div>
      {overflow > 0 && (
        <span className="ml-2 text-xs font-medium text-slate-500">+{overflow}</span>
      )}
    </div>
  )
}
