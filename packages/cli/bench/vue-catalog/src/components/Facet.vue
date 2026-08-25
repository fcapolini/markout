<script setup vapor lang="ts">
defineProps<{ label: string; options: string[]; active: string }>();
defineEmits<{ pick: [value: string] }>();
</script>

<template>
  <div class="facet">
    <p class="facet-label">{{ label }}</p>
    <div class="facet-options">
      <button
        v-for="opt in options"
        :key="opt"
        :class="'chip' + (opt === active ? ' chip-on' : '')"
        @click="$emit('pick', opt)"
      >{{ opt }}</button>
    </div>
  </div>
</template>
