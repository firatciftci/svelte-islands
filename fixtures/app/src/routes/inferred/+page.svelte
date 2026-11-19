<script lang="ts">
  import { Island } from "svelte-islands";

  const { data } = $props();
</script>

<svelte:head>
  <title>Inferred</title>
</svelte:head>

<h1>Inferred</h1>
<a href="/">Home</a>

<Island part={data.rows}>
  {#snippet children(rows)}
    <ul class="inferred-rows" data-testid="inferred">
      {#each rows as row (row.id)}
        <li>{row.name}</li>
      {/each}
    </ul>
  {/snippet}
</Island>
