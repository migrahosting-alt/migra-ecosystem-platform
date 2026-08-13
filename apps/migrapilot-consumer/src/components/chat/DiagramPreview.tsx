import { cn } from '@/lib/cn'

const boxStyle = {
  fill: '#ffffff',
  stroke: '#cbd5e1',
  strokeWidth: 1,
  rx: 3,
}
const labelStyle = { fontSize: 5.4, fill: '#475569', fontWeight: 500 }
const link = { stroke: '#94a3b8', strokeWidth: 0.9, strokeDasharray: '2.5 2', fill: 'none' }

/**
 * Stand-in renders for the images a user drops into a conversation. Drawn as
 * SVG so previews stay crisp at any size and need no binary assets.
 */
export function DiagramPreview({
  variant,
  className,
}: {
  variant: 'architecture' | 'flowchart'
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 240 110"
      className={cn('h-full w-full', className)}
      role="img"
      aria-label={variant === 'architecture' ? 'Architecture diagram' : 'Migration flowchart'}
    >
      <rect width="240" height="110" fill="#fdfefe" />
      {variant === 'architecture' ? <Architecture /> : <Flowchart />}
    </svg>
  )
}

function Architecture() {
  return (
    <>
      {/* users */}
      <g>
        <circle cx="20" cy="26" r="3.4" fill="#60a5fa" />
        <circle cx="27" cy="24" r="2.6" fill="#93c5fd" />
        <circle cx="14" cy="24" r="2.6" fill="#93c5fd" />
        <rect x="12" y="30" width="16" height="5" rx="2.5" fill="#bfdbfe" />
        <text x="20" y="43" textAnchor="middle" {...labelStyle}>
          Users
        </text>
      </g>

      <path d="M31 32 H56" {...link} />

      <rect x="56" y="42" width="38" height="16" {...boxStyle} />
      <text x="75" y="52.5" textAnchor="middle" {...labelStyle}>
        Web App
      </text>
      <path d="M20 47 V50 H56" {...link} />

      <rect x="104" y="40" width="36" height="20" fill="#eff6ff" stroke="#93c5fd" strokeWidth="1" rx="3" />
      <text x="122" y="48.5" textAnchor="middle" {...labelStyle} fill="#1d4ed8">
        API
      </text>
      <text x="122" y="55.5" textAnchor="middle" {...labelStyle} fill="#1d4ed8">
        Gateway
      </text>
      <path d="M94 50 H104" {...link} />

      {[
        { y: 20, label: 'Auth Service' },
        { y: 42, label: 'User Service' },
        { y: 64, label: 'Data Service' },
      ].map(({ y, label }) => (
        <g key={label}>
          <rect x="152" y={y} width="42" height="15" {...boxStyle} />
          <text x="173" y={y + 9.6} textAnchor="middle" {...labelStyle}>
            {label}
          </text>
          <path d={`M140 50 C146 50 146 ${y + 7.5} 152 ${y + 7.5}`} {...link} />
        </g>
      ))}

      {/* database cylinder */}
      <g>
        <ellipse cx="216" cy="42" rx="10" ry="3.4" fill="#dbeafe" stroke="#93c5fd" strokeWidth="0.9" />
        <path d="M206 42 V54 a10 3.4 0 0 0 20 0 V42" fill="#eff6ff" stroke="#93c5fd" strokeWidth="0.9" />
        <text x="216" y="64" textAnchor="middle" {...labelStyle}>
          Database
        </text>
      </g>
      <path d="M194 71.5 C202 71.5 206 60 206 54" {...link} />

      <rect x="196" y="84" width="34" height="14" {...boxStyle} />
      <text x="213" y="93" textAnchor="middle" {...labelStyle}>
        Storage
      </text>
      <path d="M173 79 V91 H196" {...link} />
    </>
  )
}

function Flowchart() {
  const nodes = [
    { x: 16, y: 46, w: 34, label: 'Assess' },
    { x: 66, y: 46, w: 34, label: 'Prepare' },
    { x: 116, y: 24, w: 34, label: 'Migrate' },
    { x: 116, y: 68, w: 34, label: 'Verify' },
    { x: 172, y: 46, w: 38, label: 'Go-live' },
  ]
  return (
    <>
      {nodes.map((node) => (
        <g key={node.label}>
          <rect x={node.x} y={node.y} width={node.w} height="16" {...boxStyle} />
          <text x={node.x + node.w / 2} y={node.y + 10.5} textAnchor="middle" {...labelStyle}>
            {node.label}
          </text>
        </g>
      ))}
      <path d="M50 54 H66" {...link} />
      <path d="M100 54 C108 54 108 32 116 32" {...link} />
      <path d="M100 54 C108 54 108 76 116 76" {...link} />
      <path d="M150 32 C160 32 162 54 172 54" {...link} />
      <path d="M150 76 C160 76 162 54 172 54" {...link} />
      <circle cx="191" cy="24" r="6" fill="#dcfce7" stroke="#86efac" strokeWidth="0.9" />
      <path d="M188.4 24 l1.8 1.9 l3.4 -3.6" stroke="#16a34a" strokeWidth="1.2" fill="none" />
    </>
  )
}

/** Deterministic audio waveform — no randomness so it renders identically. */
export function Waveform({ bars = 48, className }: { bars?: number; className?: string }) {
  return (
    <div
      className={cn('flex h-9 min-w-0 flex-1 items-center gap-px overflow-hidden', className)}
      aria-hidden
    >
      {Array.from({ length: bars }, (_, index) => {
        const wave =
          Math.sin(index * 0.55) * 0.32 + Math.sin(index * 1.37) * 0.24 + Math.sin(index * 0.21) * 0.2
        const height = 18 + Math.abs(wave) * 82
        return (
          <span
            key={index}
            className="w-[2px] shrink-0 rounded-full bg-brand-300"
            style={{ height: `${height}%` }}
          />
        )
      })}
    </div>
  )
}
