/**
 * What a static image import evaluates to under `node --test`.
 *
 * `next build` turns `import logo from './logo.png'` into an object describing
 * the asset. Node has no loader for image bytes, so importing any component
 * whose tree reaches the brand mark threw `ERR_UNKNOWN_FILE_EXTENSION` — which
 * is why no chat component had ever been rendered in a test, and why the only
 * available guard was matching the source file as text.
 *
 * The shape matches Next's static import so `next/image` receives what it
 * expects; the bytes are irrelevant to every assertion made against it.
 */
export default {
  src: '/_test/asset.png',
  height: 128,
  width: 128,
  blurDataURL: '',
  blurWidth: 0,
  blurHeight: 0,
}
