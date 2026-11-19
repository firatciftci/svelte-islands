<script lang="ts">
  import { Island } from "svelte-islands";

  const { data } = $props();
</script>

<h1>Rows</h1>
<Island part={data.rows}>
  {#snippet children(rows)}
    <ul>
      {#each rows as row (row.id)}
        <li><button type="button">{row.label}</button></li>
      {/each}
    </ul>
  {/snippet}
</Island>
