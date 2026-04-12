"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 40, fontFamily: "system-ui, sans-serif", color: "#ccc", background: "#1e1e1e", minHeight: "100vh" }}>
        <h2 style={{ color: "#f44747" }}>Critical Error</h2>
        <p style={{ color: "#858585", maxWidth: 600 }}>
          The application encountered a critical error. Please try refreshing the page.
        </p>
        {error.digest && (
          <pre style={{ fontSize: 12, color: "#666", marginTop: 8 }}>Error ID: {error.digest}</pre>
        )}
        <button
          onClick={reset}
          style={{
            marginTop: 16,
            padding: "8px 20px",
            background: "#0e639c",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
