/**
 * `next/image`, reduced to the one thing a markup assertion cares about.
 *
 * The real component needs the image-config context `next build` injects, and
 * renders a `srcset` full of optimiser URLs that would only make assertions
 * brittle. What a test needs from it is that an image is emitted at all, and
 * that its alt text and `aria-hidden` survive — those are the properties that
 * decide whether a decorative mark is announced to a screen reader.
 */
import { createElement } from 'react'

export default function Image({ src, alt, ...rest }) {
  const url = typeof src === 'string' ? src : (src?.src ?? '')
  // `priority`, `sizes`, `fill` and friends are Next's own optimiser hints and
  // are not valid DOM attributes; passing them through produces React warnings
  // that would drown the actual assertion output.
  const { priority, sizes, fill, quality, loader, placeholder, blurDataURL, unoptimized, ...attrs } = rest
  void priority, sizes, fill, quality, loader, placeholder, blurDataURL, unoptimized
  return createElement('img', { src: url, alt: alt ?? '', ...attrs })
}
