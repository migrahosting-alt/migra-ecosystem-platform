"use client";

import { InboxItemCard } from "./InboxItemCard";

interface InboxItem {
  id: string;
  type: "mission" | "drift" | "approval" | "notification";
  severity: "info" | "warn" | "critical";
  title: string;
  message: string;
  deepLink: string;
  createdAt: string;
  meta?: Record<string, unknown>;
}

interface InboxSectionProps {
  label: string;
  icon: string;
  count: number;
  items: InboxItem[];
  onAcknowledge?: (id: string) => void;
  onExecuteNow?: (id: string) => void;
  onRetry?: (id: string) => void;
}

export function InboxSection({
  label,
  icon,
  count,
  items,
  onAcknowledge,
  onExecuteNow,
  onRetry,
}: InboxSectionProps) {
  if (count === 0) return null;

  return (
    <section style={{ marginBottom: "1.5rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginBottom: "0.5rem",
          paddingBottom: "0.25rem",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <span style={{ fontSize: "1.1rem" }}>{icon}</span>
        <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>{label}</h3>
        <span
          style={{
            fontSize: "0.75rem",
            padding: "0.1rem 0.5rem",
            borderRadius: 12,
            background: "rgba(255,255,255,0.1)",
            color: "#ccc",
          }}
        >
          {count}
        </span>
      </div>
      {items.map((item) => (
        <InboxItemCard
          key={item.id}
          {...item}
          onAcknowledge={onAcknowledge}
          onExecuteNow={onExecuteNow}
          onRetry={onRetry}
        />
      ))}
      {items.length < count && (
        <p style={{ fontSize: "0.75rem", color: "#888", margin: "0.25rem 0 0 1rem" }}>
          Showing {items.length} of {count}
        </p>
      )}
    </section>
  );
}
