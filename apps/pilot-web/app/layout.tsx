import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "MigraPilot", icons: "/favicon.ico" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; }
          :root {
            --bg:        #1e1e1e;
            --bg-sidebar: #252526;
            --bg-input:  #2d2d2d;
            --bg-hover:  #2a2d2e;
            --bg-active: #37373d;
            --border:    #3c3c3c;
            --fg:        #cccccc;
            --fg-dim:    #858585;
            --fg-bright: #e8e8e8;
            --accent:    #0078d4;
            --accent-fg: #ffffff;
            --success:   #4ec9b0;
            --warning:   #dcdcaa;
            --danger:    #f14c4c;
            --info:      #569cd6;
            /* Mode accents */
            --mode-operator:    #0078d4;
            --mode-engineering: #e8823a;
            --mode-incident:    #f85149;
            --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
                    Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue",
                    sans-serif;
            --mono: "Cascadia Code", "Fira Code", Consolas, "Courier New", monospace;
          }
          html, body { margin:0; padding:0; height:100%; background:var(--bg); color:var(--fg); font-family:var(--font); font-size:13px; line-height:1.5; -webkit-font-smoothing:antialiased; }
          #__next, main { height:100%; }
          ::-webkit-scrollbar { width:8px; }
          ::-webkit-scrollbar-track { background:transparent; }
          ::-webkit-scrollbar-thumb { background:var(--border); border-radius:4px; }
          ::-webkit-scrollbar-thumb:hover { background:#555; }
          ::selection { background:rgba(0,120,212,.4); }
          a { color:var(--accent); text-decoration:none; }
          a:hover { text-decoration:underline; }
          /* Smooth transitions for cards */
          .card-hover:hover { border-color: var(--accent) !important; background: rgba(255,255,255,0.04) !important; }
        `}</style>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
