"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: 40, fontFamily: "system-ui, sans-serif", color: "#ccc", background: "#1e1e1e", minHeight: "100vh" }}>
      <h2 style={{ color: "#f44747" }}>Something went wrong</h2>
      <p style={{ color: "#858585", maxWidth: 600 }}>
        An unexpected error occurred. You can try again or return to the console home.
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
        Try again
      </button>
    </div>
  );
}
