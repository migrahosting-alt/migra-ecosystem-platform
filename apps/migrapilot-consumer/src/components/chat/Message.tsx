'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  BarChart3,
  CheckCheck,
  Copy,
  ExternalLink,
  Pause,
  Play,
  Rocket,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from 'lucide-react'
import { FileTypeIcon } from '@/components/ui/FileTypeIcon'
import { LogoMark } from '@/components/brand/Logo'
import { RichText } from './RichText'
import { RichAnswer } from '@/features/markdown/RichAnswer'
import { ImageViewer } from './ImageViewer'
import { SourceIcon } from './SourceIcon'
import { DiagramPreview, Waveform } from './DiagramPreview'
import type { Attachment, Block, Message } from '@/data/types'
import { cn } from '@/lib/cn'

const titleIcons = {
  chart: BarChart3,
  rocket: Rocket,
  shield: ShieldCheck,
}

const titleIconTones = {
  chart: 'text-brand-text',
  rocket: 'text-orange-500',
  shield: 'text-emerald-600',
}

function BlockView({ block, divided }: { block: Block; divided: boolean }) {
  if (block.type === 'paragraph') {
    /*
     * A model answer arrives as ONE paragraph block containing markdown, and
     * rendering it as plain text put `### Key Design Elements`, `**bold**` and
     * fenced code on screen as literal characters — the transcript showing raw
     * output instead of an answer.
     *
     * `RichAnswer` handles a plain sentence as a single paragraph, so nothing
     * changes for short replies; structure only appears when the text has any.
     */
    return <RichAnswer text={block.text} />
  }

  const Icon = block.titleIcon ? titleIcons[block.titleIcon] : null

  return (
    <div className={cn(divided && 'border-t border-hairline pt-5')}>
      {block.title && (
        <h3 className="mb-2.5 flex items-center gap-2 text-[15px] font-semibold text-slate-900">
          {Icon && (
            <Icon
              className={cn('h-[18px] w-[18px]', titleIconTones[block.titleIcon!])}
              strokeWidth={2.2}
            />
          )}
          {block.title}
        </h3>
      )}

      <ul className={cn('flex flex-col', block.variant === 'numbered' ? 'gap-2' : 'gap-1.5')}>
        {block.items.map((item, index) => (
          <li key={index} className="flex gap-2.5 text-[15px] leading-[1.65] text-slate-700">
            {block.variant === 'numbered' ? (
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
                {index + 1}
              </span>
            ) : (
              <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
            )}
            <span>
              <RichText text={item} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AudioAttachment({ attachment }: { attachment: Attachment }) {
  const [playing, setPlaying] = useState(false)

  return (
    <div className="flex flex-col rounded-xl border border-hairline bg-raised p-3.5">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
        <Play className="h-3.5 w-3.5 fill-slate-400 text-slate-400" />
        {attachment.name}
      </p>

      <div className="mt-3 flex flex-1 items-center gap-3">
        <button
          onClick={() => setPlaying((value) => !value)}
          aria-label={playing ? `Pause ${attachment.name}` : `Play ${attachment.name}`}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-text transition-colors hover:bg-brand-100"
        >
          {playing ? (
            <Pause className="h-5 w-5 fill-current" />
          ) : (
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          )}
        </button>
        <Waveform className={cn(playing && 'opacity-100', !playing && 'opacity-80')} />
        <span className="shrink-0 text-sm font-medium text-slate-500 tabular-nums">
          {attachment.duration}
        </span>
      </div>

      <p className="mt-2 text-right text-xs text-slate-400">{attachment.size}</p>
    </div>
  )
}

function ImageAttachment({ attachment }: { attachment: Attachment }) {
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-raised">
      <div className="h-[112px] border-b border-hairline bg-slate-50/60 p-1.5">
        {attachment.preview && <DiagramPreview variant={attachment.preview} />}
      </div>
      <div className="flex items-center gap-2.5 p-3">
        <FileTypeIcon name={attachment.name} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-slate-700">{attachment.name}</p>
          <p className="text-xs text-slate-400">{attachment.size}</p>
        </div>
      </div>
    </div>
  )
}

function AttachmentGrid({ attachments }: { attachments: Attachment[] }) {
  return (
    <div className="grid gap-3.5 sm:grid-cols-2">
      {attachments.map((attachment) =>
        attachment.kind === 'audio' ? (
          <AudioAttachment key={attachment.id} attachment={attachment} />
        ) : (
          <ImageAttachment key={attachment.id} attachment={attachment} />
        ),
      )}
    </div>
  )
}

function UserTurn({ message }: { message: Message }) {
  const wide = Boolean(message.attachments?.length)
  /** Which attached image is open full size, if any. */
  /** Index of the open image, or null. The whole set travels so the arrows work. */
  const [viewing, setViewing] = useState<number | null>(null)

  return (
    <div className="flex justify-end">
      <div className={cn('w-full', wide ? 'max-w-[620px]' : 'max-w-[440px]')}>
        {/*
          THE PICTURE STAYS WITH THE QUESTION.
          Above the text, because that is the order it was composed in, and
          because a transcript where the image vanished after sending gives no way
          to tell which photo an answer was about. Fetched by opaque ref from the
          caller's own library — nothing is embedded in the transcript.
        */}
        {message.images && message.images.length > 0 && (
          <div className="mb-1.5 flex flex-wrap justify-end gap-2">
            {message.images.map((ref, index) => (
              <button
                key={ref}
                type="button"
                onClick={() => setViewing(index)}
                aria-label="Open image full size"
                title="Open full size"
                className="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/images/${ref}`}
                  alt="Image attached to this message"
                  /*
                   * The transcript shows the image in its OWN shape, bounded
                   * rather than cropped. A square box cropped a portrait photo
                   * down to its middle, so the record of what was asked about no
                   * longer matched what was sent.
                   *
                   * `draggable` so it behaves like an ordinary image: dragging it
                   * out carries the real authorised URL, not a preview copy.
                   */
                  draggable
                  className="max-h-64 w-auto max-w-full cursor-pointer rounded-xl border border-slate-200 object-contain transition hover:border-slate-300"
                />
              </button>
            ))}
          </div>
        )}
        {viewing !== null && message.images && (
          <ImageViewer
            refs={message.images}
            startIndex={viewing}
            alt="Image attached to this message"
            onClose={() => setViewing(null)}
          />
        )}

        {message.text && (
          <div className="rounded-2xl rounded-br-md bg-brand-50 px-4.5 py-3.5">
            <p className="text-[15px] leading-[1.6] text-slate-800">{message.text}</p>
            <p className="mt-1.5 flex items-center justify-end gap-1.5 text-xs text-slate-400">
              {message.time}
              {message.delivered && <CheckCheck className="h-3.5 w-3.5 text-brand-500" />}
            </p>
          </div>
        )}

        {message.attachments && (
          <>
            <AttachmentGrid attachments={message.attachments} />
            <p className="mt-1.5 flex items-center justify-end gap-1.5 text-xs text-slate-400">
              {message.time}
              {message.delivered && <CheckCheck className="h-3.5 w-3.5 text-brand-500" />}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function AssistantTurn({
  message,
}: {
  message: Message
}) {
  const [vote, setVote] = useState<'up' | 'down' | null>(null)
  const blocks = message.blocks ?? []

  /*
   * A failed turn is a system notice, not an answer.
   *
   * It is rendered without the assistant avatar, the answer card, or the
   * copy/rate controls — every one of those would frame it as model output.
   * `role="status"` announces it as a state change rather than content.
   */
  if (message.error) {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3.5"
      >
        <TriangleAlert className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600" strokeWidth={2} />
        <div className="min-w-0 flex-1">
          {blocks.map((block, index) => (
            <p key={index} className="text-[13px] leading-relaxed text-amber-900">
              {block.type === 'paragraph' ? block.text : null}
            </p>
          ))}
          <span className="mt-1.5 block text-xs text-amber-700/70">{message.time}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3.5">
      <LogoMark className="mt-1 h-8 w-8 shrink-0" id={`msg-${message.id}`} />

      <div className="min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-md border border-hairline bg-raised p-5 shadow-card sm:p-6">
          <div className="flex flex-col gap-5">
            {blocks.map((block, index) => (
              <BlockView
                key={index}
                block={block}
                divided={index > 0 && block.type === 'list' && blocks[index - 1]?.type === 'list'}
              />
            ))}
          </div>

          {message.sources && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {message.sources.map((source) => (
                <a
                  key={source.id}
                  href={`https://${source.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-3 rounded-xl border border-hairline bg-raised px-3.5 py-3 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
                >
                  <SourceIcon domain={source.domain} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-slate-800">
                      {source.title}
                    </span>
                    <span className="block truncate text-xs text-slate-400">{source.domain}</span>
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-colors group-hover:text-brand-500" />
                </a>
              ))}
            </div>
          )}

          {/*
            * A real answer that storage refused. Stated in the user's terms —
            * what will happen to it — not in ours.
            */}
          {message.unsaved && (
            <div
              role="status"
              className="mt-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[13px] text-amber-900"
            >
              <span aria-hidden="true">⚠</span>
              <span>
                <strong className="font-semibold">Not saved.</strong> This answer was produced, but
                storage was unavailable — it will not be here after you reload. Copy anything you
                need to keep.
              </span>
            </div>
          )}

          {/*
            * Provenance the user can check. These names are intersected with the
            * caller's real library server-side, so a model-invented filename can
            * never appear here — see `citedFiles` in the stream route.
            */}
          {message.citedFiles && message.citedFiles.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
              <span className="text-[13px] font-medium text-slate-500">From your files:</span>
              {message.citedFiles.map((name) => (
                <Link
                  key={name}
                  href="/files"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-raised px-2.5 py-1 text-[12.5px] font-semibold text-slate-700 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
                >
                  <FileTypeIcon name={name} size="sm" />
                  {name}
                </Link>
              ))}
            </div>
          )}


          <div className="mt-5 flex items-center justify-between border-t border-hairline pt-3.5">
            <span className="text-xs text-slate-400">{message.time}</span>
            <div className="flex items-center gap-1">
              <button
                aria-label="Copy answer"
                title="Copy answer"
                onClick={() => {
                  const text = blocks
                    .map((block) =>
                      block.type === 'paragraph'
                        ? block.text
                        : [block.title, ...block.items].filter(Boolean).join('\n'),
                    )
                    .join('\n\n')
                    .replace(/\*\*/g, '')
                  void navigator.clipboard?.writeText(text).catch(() => undefined)
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                aria-label="Good response"
                aria-pressed={vote === 'up'}
                onClick={() => setVote(vote === 'up' ? null : 'up')}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                  vote === 'up'
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
                )}
              >
                <ThumbsUp className="h-4 w-4" />
              </button>
              <button
                aria-label="Bad response"
                aria-pressed={vote === 'down'}
                onClick={() => setVote(vote === 'down' ? null : 'down')}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                  vote === 'down'
                    ? 'bg-red-50 text-red-600'
                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
                )}
              >
                <ThumbsDown className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function MessageView({
  message,
}: {
  message: Message
}) {
  return (
    <div className="animate-fade-up">
      {message.role === 'user' ? (
        <UserTurn message={message} />
      ) : (
        <AssistantTurn message={message} />
      )}
    </div>
  )
}

/** Three-dot thinking indicator shown while a reply is being generated. */
export function TypingIndicator() {
  return (
    <div className="flex animate-fade gap-3.5">
      <LogoMark className="mt-1 h-8 w-8 shrink-0" id="typing" />
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-hairline bg-raised px-5 py-4 shadow-card">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-2 w-2 animate-bounce rounded-full bg-brand-300"
            style={{ animationDelay: `${index * 140}ms`, animationDuration: '1s' }}
          />
        ))}
      </div>
    </div>
  )
}
