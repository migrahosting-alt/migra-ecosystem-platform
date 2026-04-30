<template>
  <div class="min-h-screen bg-[#0f0f0f] text-white">
    <!-- Header -->
    <header class="border-b border-white/10 px-6 py-4 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-7 h-7 rounded bg-violet-600 flex items-center justify-center text-xs font-bold">M</div>
        <span class="font-semibold text-sm tracking-wide">MigraBuilder</span>
      </div>
      <div class="flex items-center gap-4 text-sm text-white/50">
        <span v-if="userEmail">{{ userEmail }}</span>
        <button class="hover:text-white transition" @click="logout">Sign out</button>
      </div>
    </header>

    <!-- Auth wall -->
    <div v-if="!token" class="flex items-center justify-center min-h-[calc(100vh-64px)]">
      <div class="text-center space-y-4 max-w-sm w-full px-6">
        <div class="w-12 h-12 rounded-xl bg-violet-600 flex items-center justify-center text-2xl mx-auto">M</div>
        <h1 class="text-2xl font-bold">MigraBuilder</h1>
        <p class="text-white/50 text-sm">Sign in to build and manage your sites.</p>
        <a
          :href="authLoginUrl"
          class="block w-full py-2.5 bg-violet-600 hover:bg-violet-500 rounded-lg font-semibold text-sm transition text-center"
        >Continue with MigraTeck account</a>
        <div class="text-xs text-white/30 pt-2">
          Dev: paste token below
          <input
            v-model="devToken"
            type="text"
            placeholder="Bearer token for dev"
            class="mt-2 w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs focus:outline-none focus:border-violet-500"
            @change="applyDevToken"
          />
        </div>
      </div>
    </div>

    <!-- Main content -->
    <main v-else class="max-w-5xl mx-auto px-6 py-10">

      <!-- Sites list -->
      <div class="flex items-center justify-between mb-8">
        <div>
          <h2 class="text-xl font-bold">My Sites</h2>
          <p class="text-white/40 text-sm mt-1">Click a site to manage its pages</p>
        </div>
        <button
          class="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-semibold transition"
          @click="showCreateSite = true"
        >+ New site</button>
      </div>

      <div v-if="loading" class="text-white/40 text-sm">Loading…</div>
      <div v-else-if="error" class="text-red-400 text-sm">{{ error }}</div>

      <div v-else-if="sites.length === 0" class="text-center py-20 text-white/30">
        <p class="text-4xl mb-4">🏗️</p>
        <p class="font-semibold">No sites yet</p>
        <p class="text-sm mt-1">Create your first site to get started</p>
      </div>

      <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="site in sites"
          :key="site.id"
          class="bg-white/5 border border-white/10 rounded-xl p-5 hover:border-violet-500/50 transition cursor-pointer group"
          :class="{ 'border-violet-500/50': expandedSiteId === site.id }"
          @click="toggleSite(site.id)"
        >
          <div class="flex items-start justify-between">
            <div>
              <h3 class="font-semibold text-sm">{{ site.name }}</h3>
              <p class="text-white/30 text-xs mt-0.5">{{ site.domain || 'No domain' }}</p>
            </div>
            <span class="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/50">{{ site.status }}</span>
          </div>
          <p class="text-xs text-white/20 mt-3">{{ formatDate(site.created_at) }}</p>

          <!-- Pages for this site -->
          <div v-if="expandedSiteId === site.id" class="mt-4 pt-4 border-t border-white/10 space-y-2">
            <div v-if="loadingPages[site.id]" class="text-white/40 text-xs">Loading pages…</div>

            <div
              v-for="page in pagesBySite[site.id] ?? []"
              :key="page.id"
              class="flex items-center justify-between text-xs rounded-lg px-3 py-2 bg-white/5 hover:bg-white/10 transition"
            >
              <span>{{ page.title }}</span>
              <span class="flex items-center gap-2">
                <span class="text-white/30">{{ page.status }}</span>
                <button
                  class="text-violet-400 hover:text-violet-300"
                  @click.stop="openEditor(site.id, page.id)"
                >Edit →</button>
              </span>
            </div>

            <div v-if="!loadingPages[site.id] && (pagesBySite[site.id] ?? []).length === 0" class="text-white/30 text-xs">
              No pages yet
            </div>

            <button
              class="w-full text-xs py-1.5 border border-dashed border-white/20 rounded-lg text-white/40 hover:text-white/70 hover:border-white/40 transition mt-1"
              @click.stop="createPage(site.id)"
            >+ New page</button>
          </div>
        </div>
      </div>
    </main>

    <!-- Create site modal -->
    <div v-if="showCreateSite" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
      <div class="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-4">
        <h3 class="font-bold">New Site</h3>
        <div class="space-y-3">
          <div>
            <label class="text-xs text-white/50 block mb-1">Site name *</label>
            <input
              v-model="newSiteName"
              type="text"
              class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
              placeholder="My Awesome Site"
              @keydown.enter="submitCreateSite"
            />
          </div>
          <div>
            <label class="text-xs text-white/50 block mb-1">Domain (optional)</label>
            <input
              v-model="newSiteDomain"
              type="text"
              class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
              placeholder="mysite.com"
            />
          </div>
        </div>
        <div class="flex gap-3 pt-1">
          <button class="flex-1 py-2 rounded-lg border border-white/10 text-sm hover:bg-white/5 transition" @click="showCreateSite = false">Cancel</button>
          <button class="flex-1 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-semibold transition" @click="submitCreateSite">Create</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  getToken,
  setToken,
  clearToken,
  listSites,
  createSite,
  listPages,
  createPage as apiCreatePage,
  type Site,
  type Page,
} from '../api/client';

const router = useRouter();

const AUTH_URL = (import.meta.env.VITE_AUTH_URL as string | undefined) ?? 'https://auth.migrateck.com';
const CLIENT_ID = (import.meta.env.VITE_CLIENT_ID as string | undefined) ?? 'migrabuilder';

const token = ref<string | null>(getToken());
const userEmail = ref<string | null>(null);
const devToken = ref('');

const authLoginUrl = computed(() => {
  const redirectUri = encodeURIComponent(window.location.origin + '/auth/callback');
  return `${AUTH_URL}/login?client_id=${CLIENT_ID}&redirect_uri=${redirectUri}&response_type=token`;
});

function applyDevToken() {
  const t = devToken.value.trim().replace(/^Bearer\s+/i, '');
  if (!t) return;
  setToken(t);
  token.value = t;
  loadSites();
}

function logout() {
  clearToken();
  token.value = null;
  sites.value = [];
}

// ── Sites ──────────────────────────────────────────────────────────
const sites = ref<Site[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function loadSites() {
  loading.value = true;
  error.value = null;
  try {
    sites.value = await listSites();
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to load sites';
    if (error.value?.includes('401') || error.value?.includes('unauthorized')) {
      clearToken();
      token.value = null;
    }
  } finally {
    loading.value = false;
  }
}

// ── Site expansion + pages ──────────────────────────────────────────
const expandedSiteId = ref<string | null>(null);
const pagesBySite = ref<Record<string, Page[]>>({});
const loadingPages = ref<Record<string, boolean>>({});

async function toggleSite(siteId: string) {
  if (expandedSiteId.value === siteId) {
    expandedSiteId.value = null;
    return;
  }
  expandedSiteId.value = siteId;
  if (!pagesBySite.value[siteId]) {
    loadingPages.value[siteId] = true;
    try {
      pagesBySite.value[siteId] = await listPages(siteId);
    } finally {
      loadingPages.value[siteId] = false;
    }
  }
}

async function createPage(siteId: string) {
  const page = await apiCreatePage(siteId, 'Untitled Page');
  if (!pagesBySite.value[siteId]) pagesBySite.value[siteId] = [];
  pagesBySite.value[siteId].unshift(page);
  openEditor(siteId, page.id);
}

function openEditor(siteId: string, pageId: string) {
  router.push(`/sites/${siteId}/pages/${pageId}`);
}

// ── Create site modal ──────────────────────────────────────────────
const showCreateSite = ref(false);
const newSiteName = ref('');
const newSiteDomain = ref('');

async function submitCreateSite() {
  const name = newSiteName.value.trim();
  if (!name) return;
  try {
    const site = await createSite(name, newSiteDomain.value.trim() || undefined);
    sites.value.unshift(site);
    showCreateSite.value = false;
    newSiteName.value = '';
    newSiteDomain.value = '';
  } catch (e: unknown) {
    alert(e instanceof Error ? e.message : 'Failed to create site');
  }
}

// ── Utils ──────────────────────────────────────────────────────────
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Init ──────────────────────────────────────────────────────────
onMounted(() => {
  // Check for token in URL hash (implicit grant callback)
  const hash = window.location.hash;
  if (hash.includes('access_token=')) {
    const params = new URLSearchParams(hash.replace('#', ''));
    const t = params.get('access_token');
    if (t) {
      setToken(t);
      token.value = t;
      window.history.replaceState({}, '', window.location.pathname);
    }
  }
  if (token.value) loadSites();
});
</script>
