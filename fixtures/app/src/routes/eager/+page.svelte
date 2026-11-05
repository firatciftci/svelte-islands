<script lang="ts">
  import { Island, load } from "svelte-islands";
  import Rows from "#lib/rows.svelte";

  const { data } = $props();

  let isFetched = $state(false);
</script>

<svelte:head>
  <title>Eager</title>
</svelte:head>

<h1>Eager</h1>

<Island part={data.eagerRows} when="eager">
  {#snippet children(rows)}
    <Rows {rows} label="eager" />
  {/snippet}
</Island>

<button
  type="button"
  data-testid="fetch"
  onclick={() => {
    void load(data.laterRows).then(() => {
      isFetched = true;
    });
  }}
>
  Fetch another part
</button>
<output data-testid="fetched">{isFetched}</output>
