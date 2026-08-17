<script lang="ts">
  import type { Snippet } from 'svelte';
  let { kicker, heading, actions, children }: {
    kicker: string;
    heading: string;
    actions?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class="panel">
  <header class="panel-head">
    <div><p class="kicker">{kicker}</p><h2>{heading}</h2></div>
    <div class="panel-actions">{#if actions}{@render actions()}{/if}</div>
  </header>
  {@render children()}
</section>
