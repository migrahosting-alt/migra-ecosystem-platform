<template>
  <div class="h-full rounded-2xl border border-dashed border-slate-800 bg-gradient-to-br from-slate-900/90 via-slate-950 to-slate-900 p-8 flex flex-col justify-between">
    <div>
      <p class="text-xs uppercase tracking-[0.5em] text-slate-500">Studio Canvas</p>
      <h2 class="text-3xl font-semibold text-white mt-3">Design stage ready</h2>
      <p class="mt-2 text-sm leading-relaxed text-slate-400">
        Drag widgets from the sidebar, stack responsive sections, and send changes to the live preview.
      </p>
    </div>
    <div class="flex flex-wrap gap-3">
      <button class="rounded-full bg-gradient-to-r from-purple-600 to-indigo-500 px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/30">
        Insert block
      </button>
      <button class="rounded-full border border-slate-800 px-6 py-2 text-sm text-slate-400 hover:text-white">
        Calendar view
      </button>
      <button class="rounded-full border border-slate-800 px-6 py-2 text-sm text-slate-400 hover:text-white">
        Device preview
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
</script>
