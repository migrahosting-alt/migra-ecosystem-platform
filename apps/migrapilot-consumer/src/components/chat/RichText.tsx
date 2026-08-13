import { Fragment } from 'react'

/**
 * Renders inline **bold** and *emphasis* without pulling in a markdown parser —
 * assistant copy in this product only ever needs those two.
 */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean)

  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={index} className="font-semibold text-slate-900">
              {part.slice(2, -2)}
            </strong>
          )
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return (
            <em key={index} className="text-slate-700 italic">
              {part.slice(1, -1)}
            </em>
          )
        }
        return <Fragment key={index}>{part}</Fragment>
      })}
    </>
  )
}
