import type { MetadataRoute } from "next";
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
  ];
}
