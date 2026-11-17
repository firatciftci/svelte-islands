<script lang="ts">
  import { Island } from "svelte-islands";

  const { data } = $props();

  let presses = $state(0);
</script>

<svelte:head>
  <title>Styled</title>
</svelte:head>

<Island part={data.rows}>
  {#snippet children(rows)}
    <button
      type="button"
      class="styled"
      data-testid="styled"
      onclick={() => {
        presses += 1;
      }}
    >
      {rows.length} {presses}
    </button>
  {/snippet}
</Island>

<style>
  .styled {
    color: rgb(200, 0, 0);
  }
</style>
