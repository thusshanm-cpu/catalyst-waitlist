// ————— Hidden preview gate —————
// The public sees only the landing page + waitlist. Append `?preview=1`
// to the URL to reveal the demo flows while the product is still in
// development. Anything else forces the landing page.
export const isPreview = () =>
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('preview') === '1'
