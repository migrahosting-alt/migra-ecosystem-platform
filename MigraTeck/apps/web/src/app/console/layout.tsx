import type { Metadata } from "next";

export const metadata: Metadata = {
  applicationName: "MigraPanel",
  title: "MigraPanel Control Center",
  description:
    "Operational control center for the MigraTeck ecosystem, powered by MigraPanel.",
  manifest: "/console/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/brands/products/appicons/migrapanel-appicon-192-any.png?v=20260713c", type: "image/png", sizes: "192x192" },
      { url: "/brands/products/appicons/migrapanel-appicon-512-any.png?v=20260713c", type: "image/png", sizes: "512x512" },
    ],
    shortcut: "/brands/products/appicons/migrapanel-appicon-192-any.png?v=20260713c",
    apple: [{ url: "/brands/products/appicons/migrapanel-appicon-192-any.png?v=20260713c", sizes: "180x180", type: "image/png" }],
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <><link rel="mask-icon" href="/brands/products/appicons/migrapanel-appicon-512-maskable.png?v=20260713c" color="#8b3dff" /><div className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</div></>;
}
