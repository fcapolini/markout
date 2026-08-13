<script lang="ts">
  let { value, hits, onChange }: { value: string; hits: number; onChange: (value: string) => void } = $props();
  // mirrors Markout's $id-derived unique id for aria-labelledby
  const id = 'search-' + Math.random().toString(36).slice(2);
</script>

<label class="search">
  <span class="facet-label" {id}>Search</span>
  <input
    type="search"
    placeholder="Filter by name or brand"
    {value}
    aria-labelledby={id}
    oninput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
  />
  <span class="search-hits">{hits} matching</span>
</label>
