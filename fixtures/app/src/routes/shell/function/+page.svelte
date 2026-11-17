<script lang="ts">
  import { Island } from "svelte-islands";

  const { data } = $props();

  function shout(text: string) {
    return text.toUpperCase();
  }
</script>

<h1>Function</h1>

<Island part={data.rows}>
  {#snippet children(rows)}
    <p data-testid="shouted">{shout(rows[0]?.name ?? "")}</p>
  {/snippet}
</Island>
