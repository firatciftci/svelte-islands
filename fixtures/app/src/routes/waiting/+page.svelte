<script lang="ts">
  import { Island } from "svelte-islands";
  import Waiting from "#waiting";

  const { data } = $props();
</script>

<svelte:head>
  <title>Waiting</title>
</svelte:head>

<h1>Waiting</h1>

<Island part={data.staticRows}>
  {#snippet children()}
    <Waiting label="static" />
  {/snippet}
</Island>

<div style="block-size: 3000px"></div>

<Island part={data.deferredRows} defer>
  {#snippet children()}
    <Waiting label="deferred" />
  {/snippet}
</Island>

<div style="block-size: 3000px"></div>

<Island part={data.clientRows} ssr={false}>
  {#snippet children()}
    <Waiting label="client" />
  {/snippet}
</Island>
