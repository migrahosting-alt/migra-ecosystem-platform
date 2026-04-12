import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/platform", "/products", "/pricing", "/developers", "/company", "/portfolio", "/request-access", "/signup", "/privacy", "/terms"],
        disallow: ["/api/", "/app/", "/admin/", "/login", "/forgot-password", "/reset-password", "/verify-email", "/invite"],
      },
    ],
    sitemap: "https://migradrive.com/sitemap.xml",
    host: "https://migradrive.com",
  };
}