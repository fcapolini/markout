<script lang="ts">
  import type { Snippet } from 'svelte';
  let { current, count, prev, next }: { current: number; count: number; prev: Snippet; next: Snippet } = $props();
</script>

<nav class="pager">
  {@render prev()}
  <span class="pager-label">Page {current} of {count}</span>
  {@render next()}
</nav>
