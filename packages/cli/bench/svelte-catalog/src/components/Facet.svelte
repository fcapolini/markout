<script lang="ts">
  let { label, options, active, onPick }: {
    label: string;
    options: string[];
    active: string;
    onPick: (value: string) => void;
  } = $props();
</script>

<div class="facet">
  <p class="facet-label">{label}</p>
  <div class="facet-options">
    {#each options as opt (opt)}
      <button class={'chip' + (opt === active ? ' chip-on' : '')} onclick={() => onPick(opt)}>{opt}</button>
    {/each}
  </div>
</div>
