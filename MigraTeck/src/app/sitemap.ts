import type { MetadataRoute } from "next";

const baseUrl = "https://migradrive.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/platform", "/products", "/pricing", "/developers", "/company", "/portfolio", "/request-access", "/signup", "/privacy", "/terms"];

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.7,
  }));
}