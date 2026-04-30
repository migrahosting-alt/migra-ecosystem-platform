<template>
  <div class="migra-popover absolute left-4 bottom-4 z-50 w-[340px] max-w-[calc(100%-2rem)] rounded-2xl backdrop-blur px-4 py-3">
    <div class="flex items-center justify-between gap-3">
      <div class="font-extrabold">Keyboard shortcuts</div>
      <button
        class="migra-btn migra-btn--ghost text-xs"
        type="button"
        @click="$emit('dismiss')"
      >
        Got it
      </button>
    </div>

    <div class="mt-3 grid gap-2 text-xs">
      <div><span v-html="kbd(keybindings.moveUp)"></span> Move up</div>
      <div><span v-html="kbd(keybindings.moveDown)"></span> Move down</div>
      <div><span v-html="kbd(keybindings.jumpTop)"></span> Jump to top</div>
      <div><span v-html="kbd(keybindings.jumpBottom)"></span> Jump to bottom</div>
      <div><span v-html="kbd(keybindings.outdent)"></span> Outdent</div>
      <div><span v-html="kbd(keybindings.indentPrevSection)"></span> Indent into previous container</div>

      <div class="mt-2 font-extrabold migra-muted">Across parents</div>
      <div><span v-html="kbd(keybindings.jumpPrevParent)"></span> Jump prev parent/section</div>
      <div><span v-html="kbd(keybindings.jumpNextParent)"></span> Jump next parent/section</div>

      <div class="mt-2 font-extrabold migra-muted">Teleport (root sections)</div>
      <div><span v-html="kbd(keybindings.teleportPrevSection)"></span> Teleport prev root section</div>
      <div><span v-html="kbd(keybindings.teleportNextSection)"></span> Teleport next root section</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Keybindings } from '@/core/settings';

defineProps<{ keybindings: Keybindings }>();
defineEmits<{ (e: 'dismiss'): void }>();

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function kbd(combo: string) {
  const parts = String(combo || '')
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);

  if (!parts.length) return '';

  return parts
    .map((p) => {
      const t = escapeHtml(p);
      return `<span class="migra-kbd inline-block mr-1 rounded-lg px-2 py-[2px] font-extrabold">${t}</span>`;
    })
    .join('');
}
</script>
