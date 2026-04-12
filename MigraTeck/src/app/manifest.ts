import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MigraTeck",
    short_name: "MigraTeck",
    description:
      "MigraTeck enterprise platform for product access, secure authentication, tenant management, and downloads.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f7fb",
    theme_color: "#0f172a",
    icons: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}