<script lang="ts">
  import { Island } from "svelte-islands";
  import Slow from "#lib/slow.svelte";

  const { data } = $props();
</script>

<svelte:head>
  <title>Slow</title>
</svelte:head>

<h1>Slow</h1>

<Island part={data.rows} hydrate="interaction">
  {#snippet children(rows)}
    <Slow count={rows.length} />
  {/snippet}
</Island>
