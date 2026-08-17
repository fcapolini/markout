<script lang="ts">
  let { score, count }: { score: number; count: number } = $props();
</script>

<span class="rating">
  {#each [1, 2, 3, 4, 5] as n (n)}
    <span class={'star' + (n <= score ? ' star-on' : '')}>&#9733;</span>
  {/each}
  <span class="rating-count">{(score || 0).toFixed(1)} ({count})</span>
</span>
