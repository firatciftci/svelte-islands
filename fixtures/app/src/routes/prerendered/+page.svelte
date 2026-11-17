<script lang="ts">
  import { Island } from "svelte-islands";
  import Rows from "#lib/rows.svelte";

  const { data } = $props();
</script>

<svelte:head>
  <title>Prerendered</title>
</svelte:head>

<h1>Prerendered</h1>

<Island part={data.staticRows}>
  {#snippet children(rows)}
    <Rows {rows} label="static" />
  {/snippet}
</Island>

<Island part={data.deferredRows} render="deferred">
  {#snippet children(rows)}
    <Rows {rows} label="deferred" />
  {/snippet}
</Island>

<Island part={data.clientRows} render="client">
  {#snippet children(rows)}
    <Rows {rows} label="client" />
  {/snippet}
</Island>
