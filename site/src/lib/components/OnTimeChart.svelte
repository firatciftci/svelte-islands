<script lang="ts">
  import type { Harbor } from "#lib/harrow.js";

  let {
    rows,
    title,
    count = 10,
  }: { rows: Array<Harbor>; title: string; count?: number } = $props();

  const busiest = $derived(
    rows
      .toSorted(
        (a, b) => b.arrivals + b.departures - (a.arrivals + a.departures),
      )
      .slice(0, count)
      .toSorted((a, b) => b.onTime - a.onTime),
  );

  let hovered = $state<Harbor | null>(null);
</script>

<figure class="ontime">
  <figcaption>{title}</figcaption>
  <ol>
    {#each busiest as row (row.id)}
      <li
        class={{ lifted: hovered?.id === row.id }}
        onpointerenter={() => (hovered = row)}
        onpointerleave={() => (hovered = null)}
      >
        <span class="ontime-name">{row.name}</span>
        <span class="ontime-track">
          <span class="ontime-bar" style:inline-size={`${row.onTime}%`}></span>
        </span>
        <span class="ontime-value">{row.onTime.toFixed(1)}%</span>
      </li>
    {/each}
  </ol>
  <p class="ontime-scale" aria-hidden="true">
    <span class="ontime-ticks"
      ><span>0%</span><span>50%</span><span>100%</span></span
    >
  </p>
</figure>
