import type { Metadata } from "next";
import { Sora, Space_Grotesk } from "next/font/google";
import { CookieConsentBanner } from "@/components/privacy/cookie-consent-banner";
import "./globals.css";

const organizationStructuredData = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "MigraDrive",
  url: "https://migradrive.com",
  logo: "https://migradrive.com/icon.png",
  description:
    "MigraDrive secure cloud storage with web console, mobile access, desktop sync, and S3-compatible APIs.",
};

const websiteStructuredData = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "MigraDrive",
  url: "https://migradrive.com",
  description:
    "MigraDrive secure cloud storage with web console, mobile access, desktop sync, and S3-compatible APIs.",
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
  applicationName: "MigraDrive",
  title: {
    default: "MigraDrive",
    template: "%s | MigraDrive",
  },
  description:
    "MigraDrive secure cloud storage with web console, mobile access, desktop sync, and S3-compatible APIs.",
  metadataBase: new URL("https://migradrive.com"),
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
    title: "MigraDrive",
    description:
      "MigraDrive secure cloud storage with web console, mobile access, desktop sync, and S3-compatible APIs.",
    url: "https://migradrive.com",
    siteName: "MigraDrive",
    type: "website",
    images: [
      {
        url: "/icon.png",
        width: 512,
        height: 512,
        alt: "MigraDrive official icon",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "MigraDrive",
    description:
      "MigraDrive secure cloud storage with web console, mobile access, desktop sync, and S3-compatible APIs.",
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
