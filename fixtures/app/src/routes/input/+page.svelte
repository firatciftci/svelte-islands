<script lang="ts">
  import { Island } from "svelte-islands";
  import Form from "#lib/form.svelte";
  import Rows from "#lib/rows.svelte";

  const { data } = $props();
</script>

<svelte:head>
  <title>Input</title>
</svelte:head>

<h1>Input</h1>

<Island part={data.formRows} prefetch={false}>
  {#snippet children(rows)}
    <Form {rows} />
  {/snippet}
</Island>

<Island part={data.nearRows}>
  {#snippet children(rows)}
    <Rows {rows} label="near" />
  {/snippet}
</Island>

<Island part={data.eitherRows} hydrate={["interaction", "idle"]}>
  {#snippet children(rows)}
    <Rows {rows} label="either" />
  {/snippet}
</Island>
