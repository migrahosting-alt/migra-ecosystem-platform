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
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0a0e27", color: "#fff" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "2rem", textAlign: "center" }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700 }}>Something went wrong</h2>
          <p style={{ marginTop: "0.5rem", color: "#94a3b8" }}>An unexpected error occurred.</p>
          <button
            onClick={() => reset()}
            style={{ marginTop: "1.5rem", padding: "0.625rem 1.5rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: "0.5rem", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
