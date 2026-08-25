<script setup vapor lang="ts">
defineProps<{ score: number; count: number }>();
</script>

<template>
  <span class="rating">
    <span
      v-for="n in 5"
      :key="n"
      :class="'star' + (n <= score ? ' star-on' : '')"
    >&#9733;</span>
    <span class="rating-count">{{ (score || 0).toFixed(1) }} ({{ count }})</span>
  </span>
</template>
