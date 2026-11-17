<script lang="ts">
  import { Island } from "svelte-islands";
  import { writable } from "svelte/store";
  import { format } from "#lib/format.js";

  const { data } = $props();

  let count = $state(0);
  let name = $state("Ada");
  const tally = writable(1);
  const doubled = $derived(count * 2);
  const groups = ["north", "south"];
</script>

<svelte:head>
  <title>Scope</title>
</svelte:head>

<h1>Scope</h1>
<p data-testid="page-state">{count}|{name}|{$tally}</p>
<button
  type="button"
  data-testid="page-bump"
  onclick={() => {
    count += 1;
  }}
>
  bump
</button>

{#snippet badge(label: string)}
  <strong data-testid="badge">{format(label)} {doubled}</strong>
{/snippet}

<Island part={data.rows}>
  {#snippet children(rows)}
    <div data-testid="captured">
      <span data-testid="island-count">{count}</span>
      <button
        type="button"
        data-testid="island-bump"
        onclick={() => {
          count += 1;
        }}
      >
        more
      </button>
      <input aria-label="Island name" bind:value={name} />
      <button
        type="button"
        data-testid="tally"
        onclick={() => {
          $tally += 1;
        }}
      >
        {$tally}
      </button>
      {@render badge("deck")}
      <span data-testid="length">{rows.length}</span>
    </div>
  {/snippet}
</Island>

{#each groups as group, index (group)}
  <Island part={data.rows} view={group}>
    {#snippet children(rows)}
      <p data-testid="group-{group}">{group} {index} {rows[0]?.name}</p>
    {/snippet}
  </Island>
{/each}

<Island part={data.small}>
  {#snippet children(words)}
    <button
      type="button"
      data-testid="small"
      onclick={() => {
        count += 1;
      }}
    >
      {words.length}
      {count}
    </button>
  {/snippet}
</Island>
