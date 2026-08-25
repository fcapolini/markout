<script setup vapor lang="ts">
defineProps<{ value: string; hits: number }>();
defineEmits<{ change: [value: string] }>();
// mirrors Markout's $id-derived unique id for aria-labelledby
const id = 'search-' + Math.random().toString(36).slice(2);
</script>

<template>
  <label class="search">
    <span class="facet-label" :id="id">Search</span>
    <input
      type="search"
      placeholder="Filter by name or brand"
      :value="value"
      :aria-labelledby="id"
      @input="$emit('change', ($event.target as HTMLInputElement).value)"
    />
    <span class="search-hits">{{ hits }} matching</span>
  </label>
</template>
