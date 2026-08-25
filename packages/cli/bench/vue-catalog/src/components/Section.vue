<script setup vapor lang="ts">
defineProps<{ kicker: string; heading: string }>();
</script>

<template>
  <section class="panel">
    <header class="panel-head">
      <div><p class="kicker">{{ kicker }}</p><h2>{{ heading }}</h2></div>
      <div class="panel-actions"><slot name="actions" /></div>
    </header>
    <slot />
  </section>
</template>
