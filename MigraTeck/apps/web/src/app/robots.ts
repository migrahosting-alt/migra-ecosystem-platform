import type { MetadataRoute } from "next";
import { allowIndexing, absoluteUrl } from "@/lib/metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: allowIndexing ? "/" : undefined,
      disallow: allowIndexing ? undefined : "/",
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
