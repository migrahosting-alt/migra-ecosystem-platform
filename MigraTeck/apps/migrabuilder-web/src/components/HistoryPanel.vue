<template>
  <div class="p-4">
    <MigraCard
      eyebrow="History"
      title="Timeline"
      :subtitle="`${history.length} snapshots`"
    >
      <div class="migra-stack">
        <button
          v-for="(record, idx) in history"
          :key="record.ts"
          :class="['migra-history-item', idx === currentIndex ? 'migra-history-item--current' : '']"
          type="button"
          @click="$emit('jump', idx)"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="migra-history-item__title">{{ idx === currentIndex ? '● ' : '' }}{{ record.label }}</div>
              <div class="migra-history-item__meta">{{ formatTs(record.ts) }}</div>
            </div>
            <div class="migra-history-item__meta">
              {{ idx < currentIndex ? 'Past' : idx > currentIndex ? 'Future' : 'Now' }}
            </div>
          </div>
        </button>
      </div>
    </MigraCard>
  </div>
</template>

<script setup lang="ts">
import MigraCard from '@/ui/MigraCard.vue';

defineProps<{
  history: Array<{ label: string; ts: number }>;
  currentIndex: number;
}>();

defineEmits<{
  (e: 'jump', index: number): void;
}>();

function formatTs(ts: number) {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return String(ts);
  }
}
</script>
