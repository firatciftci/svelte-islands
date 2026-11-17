<script lang="ts">
  import type { Part } from "svelte-islands";
  import { Island } from "svelte-islands";
  import Greeting from "#lib/greeting.svelte";

  const {
    visitor,
    basket,
  }: {
    visitor: Part<{ name: string }>;
    basket: Part<{ items: Array<string> }>;
  } = $props();
</script>

<h1>Fresh</h1>

<Island part={visitor} render="fresh">
  {#snippet children(found)}
    <Greeting name={found.name} label="visitor" />
  {/snippet}
</Island>

<Island part={basket} render="fresh">
  {#snippet children(found)}
    <Greeting name={found.items[0] ?? ""} label="basket" />
  {/snippet}
</Island>
