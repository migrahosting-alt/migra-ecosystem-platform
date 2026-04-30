import { absoluteUrl, siteUrl } from "@/lib/metadata";
import type { ProductRecord } from "@/data/products";

export type BreadcrumbItem = { name: string; url: string };

export function buildBreadcrumbList(items: BreadcrumbItem[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function buildSoftwareApplication(product: ProductRecord): object {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: product.name,
    description: product.shortDescription,
    ...(product.links.officialWebsite ? { url: product.links.officialWebsite } : {}),
    image: absoluteUrl(product.logo),
    applicationCategory: "BusinessApplication",
    brand: {
      "@type": "Brand",
      name: "MigraTeck",
      url: siteUrl,
    },
  };
}

export const SITE_ROOT: BreadcrumbItem = { name: "MigraTeck", url: `${siteUrl}/` };
