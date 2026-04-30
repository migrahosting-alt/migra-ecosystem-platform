"use client";

import Script from "next/script";

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

/**
 * Google Analytics 4 — injected into the root layout when
 * NEXT_PUBLIC_GA_MEASUREMENT_ID is set in the environment.
 *
 * Enhanced measurement is enabled on the GA4 property itself
 * (no extra config needed here). That covers:
 *   - page views
 *   - outbound clicks (including all mailto: inquiry CTAs)
 *   - scroll depth
 *   - file downloads
 *
 * To activate: add NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX
 * to apps/web/.env.local (or the server environment).
 */
export function GoogleAnalytics() {
  if (!GA_ID) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}', {
            page_title: document.title,
            send_page_view: true,
            link_attribution: true,
          });
        `}
      </Script>
    </>
  );
}
