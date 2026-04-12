"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";

/* ── Enterprise Chat API Client ── */

const API_BASE = process.env.NEXT_PUBLIC_PILOT_API_BASE ?? "http://127.0.0.1:3377";

async function fetchEnterprise(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_BASE}/api/pilot/enterprise${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts.headers },
  });
  return res.json();
}

export const enterpriseApi = {
  /* Reactions */
  addReaction: (convId: string, msgId: string, emoji: string, sentiment?: string, feedback?: string) =>
    fetchEnterprise(`/${convId}/messages/${msgId}/reactions`, {
      method: "POST",
      body: JSON.stringify({ emoji, sentiment, feedback }),
    }),
  removeReaction: (convId: string, msgId: string, emoji: string) =>
    fetchEnterprise(`/${convId}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`, { method: "DELETE" }),
  getReactions: (convId: string, msgId: string) =>
    fetchEnterprise(`/${convId}/messages/${msgId}/reactions`),

  /* Pins */
  togglePin: (convId: string, msgId: string, pinned: boolean) =>
    fetchEnterprise(`/${convId}/messages/${msgId}/pin`, {
      method: "PATCH",
      body: JSON.stringify({ pinned }),
    }),
  getPinned: (convId: string) => fetchEnterprise(`/${convId}/pinned`),

  /* Bookmarks */
  addBookmark: (convId: string, msgId: string, label?: string, note?: string) =>
    fetchEnterprise(`/${convId}/messages/${msgId}/bookmark`, {
      method: "POST",
      body: JSON.stringify({ label, note }),
    }),
  removeBookmark: (convId: string, msgId: string) =>
    fetchEnterprise(`/${convId}/messages/${msgId}/bookmark`, { method: "DELETE" }),
  listBookmarks: () => fetchEnterprise(`/bookmarks`),

  /* Conversation management */
  updateConversation: (convId: string, data: { title?: string; archived?: boolean; pinned?: boolean; tags?: string[] }) =>
    fetchEnterprise(`/${convId}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteConversation: (convId: string) =>
    fetchEnterprise(`/${convId}`, { method: "DELETE" }),
  generateTitle: (convId: string) =>
    fetchEnterprise(`/${convId}/generate-title`, { method: "POST" }),

  /* Edit */
  editMessage: (convId: string, msgId: string, content: string) =>
    fetchEnterprise(`/${convId}/messages/${msgId}`, {
      method: "PATCH",
      body: JSON.stringify({ content }),
    }),

  /* Export */
  exportConversation: (convId: string, format: "json" | "markdown" = "json") =>
    fetch(`${API_BASE}/api/pilot/enterprise/${convId}/export?format=${format}`),

  /* Usage */
  getUsage: (convId: string) => fetchEnterprise(`/${convId}/usage`),

  /* Search */
  searchMessages: (q: string, limit = 50) => fetchEnterprise(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  /* Slash commands */
  getSlashCommands: (q?: string) => fetchEnterprise(`/slash-commands${q ? `?q=${encodeURIComponent(q)}` : ""}`),

  /* Enhanced conversation list */
  listConversations: (opts: { archived?: boolean; pinned?: boolean; tag?: string; search?: string; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.archived) params.set("archived", "true");
    if (opts.pinned) params.set("pinned", "true");
    if (opts.tag) params.set("tag", opts.tag);
    if (opts.search) params.set("search", opts.search);
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.offset) params.set("offset", String(opts.offset));
    return fetchEnterprise(`/conversations?${params.toString()}`);
  },
};

export default enterpriseApi;
