<script setup vapor lang="ts">
defineProps<{ current: number; count: number }>();
</script>

<template>
  <nav class="pager">
    <slot name="prev" />
    <span class="pager-label">Page {{ current }} of {{ count }}</span>
    <slot name="next" />
  </nav>
</template>
