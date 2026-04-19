import type { Metadata } from "next";

export const siteName = "MigraTeck";
const defaultSiteUrl = "https://migrateck.com";
const configuredSiteUrl =
  process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? defaultSiteUrl;

export const siteUrl = configuredSiteUrl.replace(/\/+$/, "");
export const allowIndexing = siteUrl === defaultSiteUrl;
export const defaultPageDescription =
  "MigraTeck connects identity, hosting, communications, workflow, billing, and software distribution into one coordinated platform for modern software businesses.";
export const defaultOgImage = "/brands/products/migrateck.png";

export function absoluteUrl(path: string): string {
  return new URL(path, siteUrl).toString();
}

type PageMetadataOptions = {
  title: string;
  description: string;
  path: string;
};

export function buildPageMetadata({
  title,
  description,
  path,
}: PageMetadataOptions): Metadata {
  const canonical = absoluteUrl(path);

  return {
    title,
    description,
    robots: allowIndexing
      ? undefined
      : {
          index: false,
          follow: false,
        },
    alternates: {
      canonical,
    },
    openGraph: {
      title: `${title} | ${siteName}`,
      description,
      url: canonical,
      siteName,
      type: "website",
      images: [
        {
          url: defaultOgImage,
          width: 1200,
          height: 1200,
          alt: "MigraTeck official logo",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | ${siteName}`,
      description,
      images: [defaultOgImage],
    },
  };
}
