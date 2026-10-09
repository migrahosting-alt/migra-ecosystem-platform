export const dynamic = "force-static";

export async function GET() {
  const body = {
    id: "/console",
    name: "MigraPanel Control Center",
    short_name: "MigraPanel",
    description: "Operational control center for the MigraTeck ecosystem, powered by MigraPanel.",
    start_url: "/console",
    scope: "/console",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#8b3dff",
    icons: [
      {
        src: "/brands/products/appicons/migrapanel-appicon-192-any.png?v=20260713c",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brands/products/appicons/migrapanel-appicon-512-any.png?v=20260713c",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brands/products/appicons/migrapanel-appicon-192-maskable.png?v=20260713c",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/brands/products/appicons/migrapanel-appicon-512-maskable.png?v=20260713c",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
