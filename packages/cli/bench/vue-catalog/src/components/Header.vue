<script setup vapor lang="ts">
withDefaults(
  defineProps<{ brand?: string; tagline: string; count: number; total: number }>(),
  { brand: 'Markout' },
);
defineEmits<{ reset: [] }>();
</script>

<template>
  <header class="app-header">
    <div class="brand-block">
      <span class="brand">{{ brand }}</span>
      <span class="tagline">{{ tagline }}</span>
    </div>
    <div class="header-actions">
      <button class="ghost" @click="$emit('reset')">Reset view</button>
      <span class="header-cart"><strong>{{ count }}</strong> in cart &middot; <strong>${{ total }}</strong></span>
    </div>
  </header>
</template>
