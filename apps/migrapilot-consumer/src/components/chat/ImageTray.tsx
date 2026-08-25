'use client'

import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * The images this turn is carrying, shown as pictures.
 *
 * A FILENAME IS NOT CONFIRMATION. "IMG_4471.HEIC" beside a paperclip asks the
 * user to trust that the right photo was picked; a thumbnail lets them see it.
 * That matters most in the case this feature exists for — someone attaching a
 * screenshot to ask what an error says.
 *
 * EVERY STATE IS THE REAL ONE. Uploading shows a placeholder that is visibly not
 * an image yet; a failure shows the SERVER'S OWN WORDS, because it knows which
 * limit was hit and a generic "upload failed" hides whether the file was too
 * large, too many pixels, or not an image at all. Nothing here optimistically
 * renders a picture that is not stored.
 */

export interface TrayImage {
  id: string
  name: string
}

export function ImageTray({ images, pending, error, onRemove, onDismissError, label }: {
  images: TrayImage[]
  /** A file being uploaded right now. Shown as itself, not as a finished image. */
  pending?: { name: string } | null
  error?: string | null
  onRemove: (id: string) => void
  onDismissError?: () => void
  /** Names what the strip is, when it is not simply "about to send". */
  label?: string
}) {
  if (images.length === 0 && !pending && !error) return null

  return (
    <div className="mb-2.5 px-1">
      {label && images.length > 0 && (
        <p className="mb-1.5 text-[12px] text-slate-500">{label}</p>
      )}

      <div className="flex flex-wrap items-start gap-2">
        {images.map((image) => (
          <figure
            key={image.id}
            className="group relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
          >
            {/*
              Served from the caller's own library by opaque id. `alt` carries the
              display name so the attachment is still identifiable to a screen
              reader, and to anyone whose images do not load.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/images/${image.id}`}
              alt={image.name}
              className="h-full w-full object-cover"
            />
            <button
              type="button"
              onClick={() => onRemove(image.id)}
              aria-label={`Remove ${image.name}`}
              title={`Remove ${image.name}`}
              className={cn(
                'absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full',
                'bg-slate-900/65 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100',
                // Always visible on touch, where there is no hover to reveal it.
                'max-md:opacity-100',
              )}
            >
              <X className="h-3 w-3" strokeWidth={2.4} />
            </button>
          </figure>
        ))}

        {pending && (
          <div
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-1"
            aria-live="polite"
          >
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
            <span className="w-full truncate text-center text-[10.5px] text-slate-500">{pending.name}</span>
          </div>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-1.5 flex items-start gap-2 text-[12.5px] leading-snug text-red-600"
        >
          <span className="min-w-0">{error}</span>
          {onDismissError && (
            <button
              type="button"
              onClick={onDismissError}
              className="shrink-0 underline underline-offset-2 opacity-70 hover:opacity-100"
            >
              dismiss
            </button>
          )}
        </p>
      )}
    </div>
  )
}
