/**
 * Model output → structured blocks.
 *
 * WHY THIS EXISTS. Every assistant answer was wrapped in a single `paragraph`
 * block and rendered as plain text, so `### Key Design Elements`, `**bold**` and
 * fenced code appeared on screen as literal characters. The transcript was
 * showing the model's raw output rather than the answer.
 *
 * NO HTML IS EVER PRODUCED. This returns data; the renderer builds React
 * elements from it. There is no `dangerouslySetInnerHTML` anywhere in the path,
 * so model output — which is untrusted text that can contain anything — has no
 * route to becoming markup. That is the sanitisation story: not a filter that has
 * to be right, but an injection surface that does not exist.
 *
 * DELIBERATELY A SUBSET. It covers what assistant answers actually contain:
 * headings, paragraphs, lists, fenced code, tables, quotes, rules, and inline
 * emphasis, code and links. Nested lists, footnotes and inline HTML are not
 * handled and degrade to text rather than being half-rendered.
 */

export type Span =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

export type RichBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'list'; ordered: boolean; items: Span[][] }
  | { kind: 'code'; language: string | null; code: string }
  | { kind: 'quote'; spans: Span[] }
  | { kind: 'table'; header: Span[][]; rows: Span[][][] }
  | { kind: 'rule' }

/**
 * Only schemes a link may safely carry.
 *
 * `javascript:` and `data:` are the two that turn a rendered link into script
 * execution. An anchor whose href fails this is rendered as plain text rather
 * than silently dropped, so the address is still readable.
 */
const SAFE_SCHEME = /^(https?:|mailto:|#|\/)/i

export function safeHref(raw: string): string | null {
  const href = raw.trim()
  if (!href || !SAFE_SCHEME.test(href)) return null
  return href
}

/**
 * Inline markup within one line.
 *
 * ORDER MATTERS. Code spans are taken first, because backticks suppress
 * everything inside them — `**not bold**` inside code is literal, and parsing
 * emphasis first would corrupt it.
 */
export function parseInline(input: string): Span[] {
  const spans: Span[] = []
  let rest = input

  // One pass, always taking the EARLIEST match so nesting cannot reorder output.
  const patterns: { re: RegExp; make: (m: RegExpMatchArray) => Span | null }[] = [
    { re: /`([^`]+)`/, make: (m) => ({ kind: 'code', text: m[1]! }) },
    {
      re: /\[([^\]]+)\]\(([^)\s]+)\)/,
      make: (m) => {
        const href = safeHref(m[2]!)
        // An unsafe scheme becomes text, not a dropped link: the reader still
        // sees where it pointed.
        return href ? { kind: 'link', text: m[1]!, href } : { kind: 'text', text: `${m[1]} (${m[2]})` }
      },
    },
    { re: /\*\*([^*]+)\*\*/, make: (m) => ({ kind: 'strong', text: m[1]! }) },
    { re: /__([^_]+)__/, make: (m) => ({ kind: 'strong', text: m[1]! }) },
    { re: /(?<![*\w])\*([^*\n]+)\*(?!\*)/, make: (m) => ({ kind: 'em', text: m[1]! }) },
    { re: /(?<![_\w])_([^_\n]+)_(?![_\w])/, make: (m) => ({ kind: 'em', text: m[1]! }) },
  ]

  let guard = 0
  while (rest.length > 0 && guard++ < 500) {
    let best: { index: number; length: number; span: Span } | null = null
    for (const { re, make } of patterns) {
      const match = re.exec(rest)
      if (!match || match.index === undefined) continue
      if (best && match.index >= best.index) continue
      const span = make(match)
      if (span) best = { index: match.index, length: match[0].length, span }
    }
    if (!best) break
    if (best.index > 0) spans.push({ kind: 'text', text: rest.slice(0, best.index) })
    spans.push(best.span)
    rest = rest.slice(best.index + best.length)
  }
  if (rest.length > 0) spans.push({ kind: 'text', text: rest })
  return spans.length > 0 ? spans : [{ kind: 'text', text: '' }]
}

const cells = (row: string): string[] =>
  row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())

export function parseMarkdown(source: string): RichBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: RichBlock[] = []
  let paragraph: string[] = []

  const flush = () => {
    if (paragraph.length === 0) return
    blocks.push({ kind: 'paragraph', spans: parseInline(paragraph.join(' ').trim()) })
    paragraph = []
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    const trimmed = line.trim()

    /*
     * FENCED CODE FIRST, and its contents are never parsed. A model explaining
     * markdown will put `###` inside a fence, and interpreting it would rewrite
     * the answer it was trying to show.
     */
    const fence = /^```(\w+)?\s*$/.exec(trimmed)
    if (fence) {
      flush()
      const code: string[] = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i]!.trim())) {
        code.push(lines[i]!)
        i += 1
      }
      blocks.push({ kind: 'code', language: fence[1] ?? null, code: code.join('\n') })
      continue
    }

    if (trimmed === '') { flush(); continue }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flush(); blocks.push({ kind: 'rule' }); continue }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flush()
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3 | 4,
        spans: parseInline(heading[2]!.trim()),
      })
      continue
    }

    const quote = /^>\s?(.*)$/.exec(trimmed)
    if (quote) {
      flush()
      const quoted = [quote[1]!]
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1]!.trim())) {
        i += 1
        quoted.push(lines[i]!.trim().replace(/^>\s?/, ''))
      }
      blocks.push({ kind: 'quote', spans: parseInline(quoted.join(' ').trim()) })
      continue
    }

    // A table needs its separator row to be a table at all; without it these are
    // just lines containing pipes.
    if (trimmed.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]!)) {
      flush()
      const header = cells(trimmed).map(parseInline)
      i += 1
      const rows: Span[][][] = []
      while (i + 1 < lines.length && lines[i + 1]!.includes('|') && lines[i + 1]!.trim() !== '') {
        i += 1
        rows.push(cells(lines[i]!.trim()).map(parseInline))
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed)
    const numbered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed)
    if (bullet || numbered) {
      flush()
      const ordered = Boolean(numbered)
      const items: Span[][] = [parseInline((bullet ? bullet[1] : numbered![2])!.trim())]
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!.trim()
        const nextItem = ordered ? /^(\d+)[.)]\s+(.*)$/.exec(next) : /^[-*+]\s+(.*)$/.exec(next)
        if (!nextItem) break
        i += 1
        items.push(parseInline((ordered ? nextItem[2] : nextItem[1])!.trim()))
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    paragraph.push(trimmed)
  }

  flush()
  return blocks
}

/** Does this text contain markup a reader should never see raw? */
export function looksLikeMarkdown(text: string): boolean {
  return /^#{1,4}\s|\*\*[^*]+\*\*|^[-*+]\s|^\d+[.)]\s|```|^>\s|\|.*\|/m.test(text)
}
