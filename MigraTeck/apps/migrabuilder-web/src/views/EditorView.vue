<template>
  <div class="h-screen flex flex-col bg-[#111]">
    <!-- Loading state -->
    <div v-if="loading" class="flex-1 flex items-center justify-center text-white/40 text-sm">
      Loading page…
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center">
      <div class="text-center space-y-4">
        <p class="text-red-400 text-sm">{{ error }}</p>
        <RouterLink to="/" class="text-violet-400 text-sm hover:underline">← Back to sites</RouterLink>
      </div>
    </div>

    <!-- Editor -->
    <EditorLayout
      v-else
      :site-id="siteId"
      :page-id="pageId"
      :page-title="pageTitle"
      :initial-doc="initialDoc"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import EditorLayout from '../components/EditorLayout.vue';
import { getPage } from '../api/client';
import type { MigraDoc } from '../core/document';

const route = useRoute();
const siteId = route.params.siteId as string;
const pageId = route.params.pageId as string;

const loading = ref(true);
const error = ref<string | null>(null);
const pageTitle = ref('Untitled Page');
const initialDoc = ref<MigraDoc | null>(null);

onMounted(async () => {
  try {
    const page = await getPage(siteId, pageId);
    pageTitle.value = page.title;
    initialDoc.value = (page.doc_json as MigraDoc | null) ?? null;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Failed to load page';
  } finally {
    loading.value = false;
  }
});
</script>
