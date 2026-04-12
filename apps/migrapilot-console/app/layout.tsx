import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./globals.css";
import { ShellWrapper } from "../components/ShellWrapper";

export const metadata: Metadata = {
  title: "MigraPilot Console",
  description: "Copilot replacement operator console for MigraPilot",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      nosnippet: true,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ShellWrapper>{children}</ShellWrapper>
      </body>
    </html>
  );
}
