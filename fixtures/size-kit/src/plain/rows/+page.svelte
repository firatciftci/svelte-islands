<script lang="ts">
  const { data } = $props();
</script>

<h1>Rows</h1>
<ul>
  {#each data.rows.loaded?.value ?? [] as row (row.id)}
    <li><button type="button">{row.label}</button></li>
  {/each}
</ul>
