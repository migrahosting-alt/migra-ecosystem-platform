import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MigraTeck",
    short_name: "MigraTeck",
    description:
      "Unified enterprise platform surface for identity, governance, product access, and distribution.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f3fb",
    theme_color: "#7118ff",
    icons: [
      {
        src: "/brands/products/migrateck.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
