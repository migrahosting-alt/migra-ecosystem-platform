/**
 * CONNECT PROJECT — the control, and nothing more than the control.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS COMPONENT IS NOT ALLOWED TO DECIDE
 *
 * Not what a project is, not who may use one, not what may be done with it,
 * and not why a connection failed. It renders what the Brain returned and
 * sends back a project id. Every sentence here that a user reads about
 * entitlement comes from the server; the only words this file owns are labels
 * on its own buttons.
 *
 * That is the shared-client rule made concrete: the consumer renders, the Brain
 * decides. A second opinion about access, formed in a browser, is how two
 * clients end up disagreeing about what someone may open.
 *
 * ---------------------------------------------------------------------------
 * THE NEGATIVE STATES ARE RENDERED AS DIFFERENT THINGS
 *
 * Collapsing them is the failure mode. "No projects available" shown to a user
 * whose access was revoked sends them hunting for something that is right
 * there; shown during an outage it is a lie about their entitlement. So the
 * remedy the server sends decides the affordance:
 *
 *   connect-project      → the chooser, or a truthful empty state
 *   request-read-access  → tell them to ask; do NOT offer reconnect, which
 *                          would fail identically
 *   retry                → offer retry; their access is fine
 *   sign-in              → sign in, WITH a sign-in action
 *
 * 🚨 `sign-in` and `retry` shared a branch, and only `retry` had a button — so
 * a visitor who needed to sign in got a sentence and no way to act on it. They
 * are separate now. A remedy the user cannot perform is not a remedy.
 *
 * That mattered because anonymous visitors were not reaching `sign-in` at all:
 * they were reaching `request-read-access` and being told they had no access to
 * a conversation they had just created. The mapping fix is server-side, in
 * `server/projects/projectPrincipal.ts`; this file's job was to give the
 * corrected state somewhere to land.
 * ---------------------------------------------------------------------------
 */

'use client'

import { useCallback, useEffect, useState } from 'react'
import { FolderGit2, Loader2, RefreshCw, X } from 'lucide-react'

interface Project {
  id: string
  label: string
  canPropose: boolean
}

/** Exactly the shape the server sends. Nothing is re-derived from it. */
interface ConnectionState {
  connected: boolean
  project?: { id: string; label: string }
  message?: string
  remedy?: string
}

const api = async (url: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> => {
  try {
    const res = await fetch(url, init)
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> }
  } catch {
    // The one thing the browser knows that the server could not tell it.
    return { status: 0, body: { message: 'You appear to be offline. Try again when you reconnect.', remedy: 'retry' } }
  }
}

export function ConnectProject({ conversationId }: { conversationId: string }) {
  /*
   * Where sign-in returns the visitor. Read at render rather than stored, so a
   * user who signs in from the rail lands back in the conversation they were
   * reading instead of at the root — the anonymous case only exists inside a
   * conversation, so returning them to "/" would lose it.
   */
  const returnPath = typeof window === 'undefined' ? `/chat/${conversationId}` : window.location.pathname

  const [state, setState] = useState<ConnectionState | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [listError, setListError] = useState<{ message: string; remedy?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const { body } = await api(`/api/conversations/${encodeURIComponent(conversationId)}/project`)
    setState(body as unknown as ConnectionState)
  }, [conversationId])

  /*
   * ASKED ON MOUNT, EVERY TIME. The binding lives on the server, so a reload —
   * or the same conversation opened on another device — has to learn it from
   * there rather than from anything this browser remembered.
   */
  useEffect(() => {
    void refresh()
  }, [refresh])

  const openChooser = useCallback(async () => {
    setChoosing(true)
    setProjects(null)
    setListError(null)
    const { status, body } = await api('/api/projects')
    if (status === 200) setProjects((body.projects as Project[]) ?? [])
    else setListError({ message: String(body.message ?? 'Your projects could not be loaded.'), remedy: body.remedy as string })
  }, [])

  const connect = useCallback(
    async (projectId: string) => {
      setBusy(true)
      const { body } = await api(`/api/conversations/${encodeURIComponent(conversationId)}/project`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The ENTIRE body. See the header.
        body: JSON.stringify({ projectId }),
      })
      setBusy(false)
      setChoosing(false)
      setState(body as unknown as ConnectionState)
    },
    [conversationId],
  )

  const disconnect = useCallback(async () => {
    setBusy(true)
    await api(`/api/conversations/${encodeURIComponent(conversationId)}/project`, { method: 'DELETE' })
    setBusy(false)
    await refresh()
  }, [conversationId, refresh])

  if (!state) return null

  /* ---------------- connected ---------------- */
  if (state.connected && state.project) {
    return (
      <div className="flex items-center gap-2" data-testid="project-connected">
        <FolderGit2 className="h-4 w-4 shrink-0 text-brand-500" strokeWidth={2} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700" title={state.project.label}>
          {/* The LABEL. The id is never shown; it exists only to be sent back. */}
          {state.project.label}
        </span>
        <button
          type="button"
          onClick={disconnect}
          disabled={busy}
          aria-label={`Stop using ${state.project.label} in this conversation`}
          title="Stop using in this conversation"
          className="rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      </div>
    )
  }

  /* ---------------- not connected, for one of several reasons ---------------- */
  const remedy = state.remedy

  /*
   * ACCESS WITHDRAWN. No Connect button: reconnecting would fail identically,
   * and offering it teaches the user the product is broken.
   */
  if (remedy === 'request-read-access') {
    return (
      <div className="flex items-start gap-2" role="status" data-testid="project-blocked">
        <FolderGit2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" strokeWidth={2} aria-hidden />
        <p className="text-[13px] leading-snug text-slate-600">
          {state.message} Ask whoever manages it for access.
        </p>
      </div>
    )
  }

  /*
   * NOT SIGNED IN — its own state, with the action that actually resolves it.
   *
   * 🚨 An anonymous visitor used to land in `request-read-access` and be told
   * "You do not have access to this conversation. Ask whoever manages it for
   * access." — about a conversation they had just created and were reading.
   * The server now sends `sign-in` for callers who cannot hold a project at
   * all, and this renders the one thing they can act on.
   *
   * Sharing the `retry` branch left this state with a sentence and no way out.
   * A remedy the user cannot perform is not a remedy.
   */
  if (remedy === 'sign-in') {
    return (
      <div className="flex items-start gap-2" role="status" data-testid="project-sign-in">
        <FolderGit2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
        <p className="flex-1 text-[13px] leading-snug text-slate-600">{state.message}</p>
        <a
          href={`/api/auth/login?next=${encodeURIComponent(returnPath)}`}
          data-testid="project-sign-in-action"
          className="shrink-0 rounded-field px-2 py-1 text-[13px] font-medium text-brand-text transition-colors hover:bg-brand-50"
        >
          Sign in
        </a>
      </div>
    )
  }

  /*
   * WE COULD NOT ASK. Their access is fine and unknown, so this offers a retry
   * and says nothing at all about what projects they have.
   */
  if (remedy === 'retry') {
    return (
      <div className="flex items-start gap-2" role="status" data-testid="project-unavailable">
        <FolderGit2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
        <p className="flex-1 text-[13px] leading-snug text-slate-600">{state.message}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1 rounded-field px-2 py-1 text-[13px] font-medium text-brand-text transition-colors hover:bg-brand-50"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          Try again
        </button>
      </div>
    )
  }

  /* ---------------- connect-project ---------------- */
  return (
    <div data-testid="project-connect">
      {!choosing ? (
        <div className="flex items-start gap-2">
          <FolderGit2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
          <p className="flex-1 text-[13px] leading-snug text-slate-600">{state.message}</p>
          <button
            type="button"
            onClick={() => void openChooser()}
            data-testid="connect-project"
            className="shrink-0 rounded-field px-2 py-1 text-[13px] font-medium text-brand-text transition-colors hover:bg-brand-50"
          >
            Connect project
          </button>
        </div>
      ) : (
        <div className="rounded-field border border-hairline bg-white p-2" data-testid="project-chooser">
          {projects === null && !listError && (
            <p className="flex items-center gap-2 px-1 py-1 text-[13px] text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden />
              Loading your projects…
            </p>
          )}

          {listError && (
            <p className="px-1 py-1 text-[13px] leading-snug text-slate-600" role="status">
              {listError.message}
            </p>
          )}

          {/*
            A TRUTHFUL EMPTY STATE, not a chooser with nothing in it. An empty
            list is a real answer and it needs its own sentence.
          */}
          {projects?.length === 0 && (
            <p className="px-1 py-1 text-[13px] leading-snug text-slate-600" data-testid="project-empty">
              No projects are available to connect yet.
            </p>
          )}

          {projects && projects.length > 0 && (
            <ul className="flex flex-col" aria-label="Projects you can connect">
              {projects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => void connect(project.id)}
                    disabled={busy}
                    data-testid="project-option"
                    className="flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-left text-[13px] text-slate-700 transition-colors hover:bg-brand-50/60 disabled:opacity-50"
                  >
                    <FolderGit2 className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
                    <span className="truncate">{project.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => setChoosing(false)}
            className="mt-1 w-full rounded-field px-2 py-1 text-left text-[13px] text-slate-500 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
