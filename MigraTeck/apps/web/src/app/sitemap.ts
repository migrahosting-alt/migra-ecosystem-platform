import type { MetadataRoute } from "next";
import { canonicalLegalDocuments } from "@/content/legal";
import { products } from "@/data/products";
import { absoluteUrl } from "@/lib/metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    "",
    "/platform",
    "/products",
    "/developers",
    "/downloads",
    "/services",
    "/company",
    "/security",
    "/legal",
  ];

  return [
    ...staticRoutes.map((route) => ({
      url: absoluteUrl(route || "/"),
      changeFrequency: "weekly" as const,
      priority: route === "" ? 1 : 0.8,
    })),
    ...products.map((product) => ({
      url: absoluteUrl(`/products/${product.slug}`),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...canonicalLegalDocuments.map((document) => ({
      url: absoluteUrl(`/legal/${document.slug}`),
      changeFrequency: "monthly" as const,
      priority: document.category === "core" ? 0.7 : 0.6,
    })),
  ];
}
