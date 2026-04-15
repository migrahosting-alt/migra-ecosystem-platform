import type { Metadata } from "next";
import { Sora, Space_Grotesk } from "next/font/google";
import { CookieConsentBanner } from "@/components/privacy/cookie-consent-banner";
import "./globals.css";

const organizationStructuredData = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "MigraTeck",
  url: "https://migrateck.com",
  logo: "https://migrateck.com/icon.png",
  description:
    "MigraTeck enterprise control plane — centralized identity, governance, and product launch surface.",
};

const websiteStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "MigraTeck",
  url: "https://migrateck.com",
  description:
    "MigraTeck enterprise control plane — centralized identity, governance, and product launch surface.",
};

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  applicationName: "MigraTeck",
  title: {
    default: "MigraTeck",
    template: "%s | MigraTeck",
  },
  description:
    "MigraTeck enterprise control plane — centralized identity, governance, and product launch surface.",
  metadataBase: new URL("https://migrateck.com"),
  manifest: "/manifest.webmanifest",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: "MigraTeck",
    description:
      "MigraTeck enterprise control plane — centralized identity, governance, and product launch surface.",
    url: "https://migrateck.com",
    siteName: "MigraTeck",
    type: "website",
    images: [
      {
        url: "/icon.png",
        width: 512,
        height: 512,
        alt: "MigraTeck official icon",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "MigraTeck",
    description:
      "MigraTeck enterprise control plane — centralized identity, governance, and product launch surface.",
    images: ["/icon.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sora.variable} ${spaceGrotesk.variable} bg-[var(--surface)] text-[var(--ink)] antialiased`}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationStructuredData),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(websiteStructuredData),
          }}
        />
        {children}
        <CookieConsentBanner />
      </body>
    </html>
  );
}
