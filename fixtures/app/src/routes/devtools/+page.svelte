<script lang="ts">
  import { Island } from "svelte-islands";
  import Rows from "#lib/rows.svelte";

  const { data } = $props();
</script>

<h1>Devtools</h1>

<div style="block-size: 3000px"></div>

<Island part={data.rows} defer>
  {#snippet children(rows)}
    <Rows {rows} label="devtools" />
  {/snippet}
</Island>
