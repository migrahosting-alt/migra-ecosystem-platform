'use client'

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ImageIcon, Lock, Mic, Paperclip, SendHorizontal } from 'lucide-react'
import { cn } from '@/lib/cn'

const toolButton =
  'inline-flex h-10 w-10 items-center justify-center rounded-field border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700'

export function Composer({
  onSubmit,
  placeholder = 'Ask anything or give MigraPilot a task...',
  variant = 'default',
  autoFocus,
  defaultValue = '',
  className,
  highlighted,
}: {
  onSubmit?: (value: string) => void
  placeholder?: string
  /** "media" adds image/mic affordances inline, as on the media review screen. */
  variant?: 'default' | 'media' | 'research'
  autoFocus?: boolean
  defaultValue?: string
  className?: string
  /** Renders the resting state already focused, as in the research mockup. */
  highlighted?: boolean
}) {
  const [value, setValue] = useState(defaultValue)
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const grow = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit?.(trimmed)
    setValue('')
    requestAnimationFrame(grow)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const active = focused || highlighted

  return (
    <form
      onSubmit={submit}
      className={cn(
        'rounded-2xl border bg-white p-3.5 transition-all duration-200',
        active
          ? 'border-brand-400 ring-4 ring-brand-500/10'
          : 'border-slate-200 shadow-card hover:border-slate-300',
        className,
      )}
    >
      <textarea
        ref={textareaRef}
        rows={variant === 'research' ? 2 : 1}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="Message MigraPilot"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          setValue(event.target.value)
          grow()
        }}
        className="scroll-slim block max-h-42 w-full resize-none bg-transparent px-1.5 pt-1 text-[15px] leading-relaxed text-slate-800 placeholder:text-slate-400 focus:outline-none"
      />

      <div className="mt-2.5 flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          {variant === 'media' ? (
            <>
              <button type="button" className={toolButton} aria-label="Record voice note">
                <Mic className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </button>
              <button type="button" className={toolButton} aria-label="Attach a file">
                <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </button>
              <button type="button" className={toolButton} aria-label="Attach an image">
                <ImageIcon className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </button>
            </>
          ) : (
            <button type="button" className={toolButton} aria-label="Attach a file">
              <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.9} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {variant !== 'media' && (
            <button type="button" className={toolButton} aria-label="Dictate">
              <Mic className="h-[18px] w-[18px]" strokeWidth={1.9} />
            </button>
          )}
          <button
            type="submit"
            aria-label="Send message"
            className="inline-flex h-10 w-10 items-center justify-center rounded-field bg-brand-600 text-white shadow-brand transition-all hover:bg-brand-700 active:scale-95 disabled:opacity-40 disabled:shadow-none"
            disabled={!value.trim()}
          >
            <SendHorizontal className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>
      </div>
    </form>
  )
}

export function ComposerDisclaimer({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        'flex items-center justify-center gap-2 text-[13px] text-slate-400',
        className,
      )}
    >
      <Lock className="h-3.5 w-3.5" strokeWidth={2} />
      MigraPilot can make mistakes. Check important info.
    </p>
  )
}
