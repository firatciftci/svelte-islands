<script lang="ts">
  import { Island } from "svelte-islands";
  import Rows from "#lib/rows.svelte";

  const { data } = $props();
</script>

<svelte:head>
  <title>Modes</title>
</svelte:head>

<h1>Modes</h1>
<a href="/">Home</a>

<Island part={data.neverRows} when="never">
  {#snippet children(rows)}
    <Rows {rows} label="never" />
  {/snippet}
</Island>

<Island part={data.staticRows}>
  {#snippet children(rows)}
    <Rows {rows} label="static" />
  {/snippet}
</Island>

<div style="block-size: 4000px"></div>

<Island part={data.deferredRows} defer>
  {#snippet children(rows)}
    <Rows {rows} label="deferred" />
  {/snippet}
</Island>

<div style="block-size: 4000px"></div>

<Island part={data.clientRows} ssr={false}>
  {#snippet children(rows)}
    <Rows {rows} label="client" />
  {/snippet}
  {#snippet failed(retry)}
    <button type="button" data-testid="retry" onclick={retry}>Try again</button>
  {/snippet}
</Island>
