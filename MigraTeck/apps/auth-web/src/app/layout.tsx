import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MigraTeck Account",
  description: "Sign in or create your MigraTeck Account — one identity for all MigraTeck products.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
          {/* Logo / brand header */}
          <div className="mb-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-sky-500 text-xl font-bold text-white shadow-lg">
              MT
            </div>
            <p className="mt-3 text-sm font-medium text-slate-500">MigraTeck Account</p>
          </div>

          {/* Content card */}
          <div className="w-full max-w-[400px]">
            {children}
          </div>

          {/* Footer */}
          <p className="mt-8 text-center text-xs text-slate-400">
            © {new Date().getFullYear()} MigraTeck. One account for all products.
          </p>
        </div>
      </body>
    </html>
  );
}
