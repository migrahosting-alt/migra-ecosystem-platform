import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import { PublicChrome } from "@/components/layout/PublicChrome";
import { getAccountLinks } from "@/lib/account-links";
import { absoluteUrl, allowIndexing, defaultPageDescription, siteUrl } from "@/lib/metadata";
import "./globals.css";

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700", "800"],
});

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "MigraTeck",
  title: {
    default: "MigraTeck",
    template: "%s | MigraTeck",
  },
  description: defaultPageDescription,
  robots: allowIndexing
    ? undefined
    : {
        index: false,
        follow: false,
      },
  icons: {
    icon: [
      { url: "/brands/products/migrateck.png", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/brands/products/migrateck.png",
    apple: "/brands/products/migrateck.png",
  },
  openGraph: {
    title: "MigraTeck",
    description: defaultPageDescription,
    type: "website",
    url: `${siteUrl}/`,
    siteName: "MigraTeck",
    images: [
      {
        url: "/brands/products/migrateck.png",
        width: 1200,
        height: 1200,
        alt: "MigraTeck official logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "MigraTeck",
    description: defaultPageDescription,
    images: ["/brands/products/migrateck.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const accountLinks = getAccountLinks();
  const organizationStructuredData = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "MigraTeck",
    url: siteUrl,
    logo: absoluteUrl("/brands/products/migrateck.png"),
    description: defaultPageDescription,
  };

  const websiteStructuredData = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "MigraTeck",
    url: siteUrl,
    description: defaultPageDescription,
  };

  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${displayFont.variable} min-h-screen antialiased`}>
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
        <PublicChrome accountLinks={accountLinks}>{children}</PublicChrome>
      </body>
    </html>
  );
}
