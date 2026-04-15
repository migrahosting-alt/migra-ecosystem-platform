"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, Card, EmptyState, ThemeToggle } from "@migrateck/auth-ui";
import { listDeveloperClients, type OAuthClientView } from "@/lib/clients-api";
import { migraAuthBrand } from "@/lib/branding";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function DeveloperAppsPage() {
  const [clients, setClients] = useState<OAuthClientView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    listDeveloperClients()
      .then((response) => {
        if (!response.ok) {
          setError("Failed to load OAuth clients.");
          return;
        }
        setClients(response.data.clients);
      })
      .catch(() => {
        setError("Failed to load OAuth clients.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#090b12_0%,#111827_50%,#090b12_100%)] px-4 py-6 text-white lg:px-6">
      <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-fuchsia-200">Developer console</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-white">OAuth apps</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
            Manage the applications that rely on MigraAuth for sign-in, authorization code exchange,
            and refresh-token rotation.
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <ThemeToggle />
          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={() => { window.location.href = "/sessions"; }}>
              Sessions
            </Button>
            <Button type="button" onClick={() => { window.location.href = "/developers/apps/new"; }}>
              New OAuth app
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <Card className="border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </Card>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className="h-52 animate-pulse bg-white/6" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <EmptyState
          title="No OAuth apps yet"
          description="Create your first client to connect a MigraTeck product, internal tool, or partner app."
          action={(
            <Button type="button" onClick={() => { window.location.href = "/developers/apps/new"; }}>
              Create your first app
            </Button>
          )}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {clients.map((client) => (
            <Link
              key={client.client_id}
              href={`/developers/apps/${client.client_id}`}
              className="group"
            >
              <Card className="h-full p-5 transition group-hover:-translate-y-0.5 group-hover:border-fuchsia-300/30 group-hover:bg-white/8">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-white">
                      {client.client_name}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-zinc-500">
                      {client.client_id}
                    </p>
                  </div>
                  <Badge tone={client.is_active ? "success" : "neutral"}>{client.is_active ? "ACTIVE" : "INACTIVE"}</Badge>
                </div>

                <p className="mt-4 min-h-10 text-sm text-zinc-400">
                  {client.description || "No description yet. Configure redirect URIs, scopes, and ownership on the detail view."}
                </p>

                <div className="mt-5 flex flex-wrap gap-2 text-xs">
                  <Badge>{client.client_type}</Badge>
                  <Badge tone="info">{client.token_auth_method}</Badge>
                  <Badge tone="primary">{client.allowed_scopes.length} scopes</Badge>
                </div>

                <div className="mt-5 flex items-center justify-between text-xs text-zinc-500">
                  <span>
                    {client.owner_organization ? `Org: ${client.owner_organization.name}` : "Personal app"}
                  </span>
                  <span>Updated {formatDate(client.updated_at)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
