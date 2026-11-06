<script lang="ts">
  import type { Ward } from "#lib/harrow.js";

  let {
    rows,
    title,
    count = 10,
  }: { rows: Array<Ward>; title: string; count?: number } = $props();

  function margin({ tide, beacon }: Ward) {
    return Math.abs(tide - beacon) / (tide + beacon);
  }

  const closest = $derived(
    rows
      .toSorted((a, b) => margin(a) - margin(b))
      .slice(0, count)
      .toSorted((a, b) => b.turnout - a.turnout),
  );

  let hovered = $state<Ward | null>(null);
</script>

<figure class="turnout">
  <figcaption>{title}</figcaption>
  <ol>
    {#each closest as row (row.id)}
      <li
        class:lifted={hovered?.id === row.id}
        onpointerenter={() => (hovered = row)}
        onpointerleave={() => (hovered = null)}
      >
        <span class="turnout-name">{row.name}</span>
        <span class="turnout-track">
          <span class="turnout-bar" style:inline-size={`${row.turnout}%`}
          ></span>
        </span>
        <span class="turnout-value">{row.turnout.toFixed(1)}%</span>
      </li>
    {/each}
  </ol>
</figure>
