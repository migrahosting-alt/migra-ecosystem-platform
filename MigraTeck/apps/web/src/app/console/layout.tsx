import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MigraPanel Control Center",
  description:
    "Operational control center for the MigraTeck ecosystem, powered by MigraPanel.",
  icons: {
    icon: "/brands/products/migrapanel-mark.png",
    shortcut: "/brands/products/migrapanel-mark.png",
    apple: "/brands/products/migrapanel-mark.png",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</div>;
}
