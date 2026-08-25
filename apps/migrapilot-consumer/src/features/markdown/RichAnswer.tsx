import { Fragment } from 'react'
import { parseMarkdown, type RichBlock, type Span } from './parse'

/**
 * A rendered assistant answer.
 *
 * REACT ELEMENTS, NEVER MARKUP. Every node below is constructed, not injected —
 * there is no `dangerouslySetInnerHTML` on this path, so model output has no
 * route to becoming HTML no matter what it contains. Sanitisation is not a filter
 * that has to be right; it is an injection surface that does not exist.
 *
 * TYPOGRAPHY IS PART OF THE ANSWER. A long reply that is one undifferentiated
 * wall is unreadable even when it is correct, so headings, lists and code get
 * real vertical rhythm rather than uniform line breaks.
 */

function Inline({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((span, index) => {
        switch (span.kind) {
          case 'strong':
            return <strong key={index} className="font-semibold text-slate-900">{span.text}</strong>
          case 'em':
            return <em key={index} className="italic">{span.text}</em>
          case 'code':
            return (
              <code
                key={index}
                className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.875em] text-slate-800"
              >
                {span.text}
              </code>
            )
          case 'link':
            return (
              <a
                key={index}
                href={span.href}
                // External links open away from the conversation, and `noopener`
                // denies the new page any handle on this one.
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 underline underline-offset-2 hover:text-brand-700"
              >
                {span.text}
              </a>
            )
          default:
            return <Fragment key={index}>{span.text}</Fragment>
        }
      })}
    </>
  )
}

const HEADING_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: 'mt-5 mb-2 text-[19px] font-semibold leading-snug text-slate-900',
  2: 'mt-5 mb-2 text-[17px] font-semibold leading-snug text-slate-900',
  3: 'mt-4 mb-1.5 text-[15.5px] font-semibold leading-snug text-slate-900',
  4: 'mt-3 mb-1 text-[15px] font-semibold leading-snug text-slate-700',
}

function Block({ block, first }: { block: RichBlock; first: boolean }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = (['h3', 'h4', 'h5', 'h6'] as const)[block.level - 1]
      // Starts at h3: the page owns h1/h2, and an answer must not outrank the
      // document it appears inside.
      return (
        <Tag className={`${HEADING_CLASS[block.level]} ${first ? 'mt-0' : ''}`}>
          <Inline spans={block.spans} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p className={`text-[15px] leading-[1.65] text-slate-800 ${first ? '' : 'mt-3'}`}>
          <Inline spans={block.spans} />
        </p>
      )
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag
          className={`${first ? '' : 'mt-3'} space-y-1.5 pl-5 text-[15px] leading-[1.65] text-slate-800 ${
            block.ordered ? 'list-decimal' : 'list-disc'
          }`}
        >
          {block.items.map((item, index) => (
            <li key={index} className="pl-1"><Inline spans={item} /></li>
          ))}
        </Tag>
      )
    }
    case 'code':
      return (
        <pre
          className={`${first ? '' : 'mt-3'} scroll-slim overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-3.5`}
        >
          {/* The language is shown rather than used for highlighting: labelling
              a block as TypeScript and then not colouring it is honest; claiming
              a highlighter exists would not be. */}
          {block.language && (
            <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {block.language}
            </span>
          )}
          <code className="block whitespace-pre font-mono text-[13px] leading-[1.6] text-slate-800">
            {block.code}
          </code>
        </pre>
      )
    case 'quote':
      return (
        <blockquote className={`${first ? '' : 'mt-3'} border-l-3 border-slate-300 pl-3.5 text-[15px] italic leading-[1.65] text-slate-600`}>
          <Inline spans={block.spans} />
        </blockquote>
      )
    case 'table':
      return (
        // Scrolls INSIDE its own container: a wide table must not make the whole
        // conversation scroll sideways.
        <div className={`${first ? '' : 'mt-3'} scroll-slim overflow-x-auto rounded-xl border border-slate-200`}>
          <table className="w-full border-collapse text-left text-[14px]">
            <thead className="bg-slate-50">
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-700">
                    <Inline spans={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-slate-100 last:border-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2 align-top text-slate-800">
                      <Inline spans={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'rule':
      return <hr className="my-4 border-slate-200" />
  }
}

export function RichAnswer({ text }: { text: string }) {
  const blocks = parseMarkdown(text)
  return (
    <div className="text-[15px] leading-[1.65] text-slate-800">
      {blocks.map((block, index) => (
        <Block key={index} block={block} first={index === 0} />
      ))}
    </div>
  )
}
