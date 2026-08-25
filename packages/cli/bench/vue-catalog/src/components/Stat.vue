<script setup vapor lang="ts">
defineProps<{ label: string; value: string | number; hint: string }>();
</script>

<template>
  <div class="stat">
    <span class="stat-label">{{ label }}</span>
    <strong class="stat-value">{{ value }}</strong>
    <span class="stat-hint">{{ hint }}</span>
  </div>
</template>
