<script lang="ts">
  import type { Harbor } from "#lib/harrow.js";

  type Column = "name" | "arrivals" | "departures" | "cargo" | "onTime";

  let {
    rows,
    limit = rows.length,
    caption,
    nameLabel = "Harbor",
    filterLabel,
  }: {
    rows: Array<Harbor>;
    limit?: number;
    caption?: string;
    nameLabel?: string;
    filterLabel?: string;
  } = $props();

  let by = $state<Column>("arrivals");
  let down = $state(true);
  let query = $state("");

  const COLUMNS: Array<{ key: Column; label: string }> = $derived([
    { key: "name", label: nameLabel },
    { key: "arrivals", label: "Arrivals" },
    { key: "departures", label: "Departures" },
    { key: "cargo", label: "Cargo (kt)" },
    { key: "onTime", label: "On time" },
  ]);

  const matching = $derived.by(() => {
    const wanted = query.trim().toLowerCase();
    return wanted === ""
      ? rows
      : rows.filter((row) => row.name.toLowerCase().includes(wanted));
  });

  const sorted = $derived(
    matching
      .toSorted((a, b) => {
        const order =
          by === "name" ? a.name.localeCompare(b.name) : a[by] - b[by];
        return down ? -order : order;
      })
      .slice(0, limit),
  );

  function sort(key: Column) {
    if (by === key) {
      down = !down;
    } else {
      by = key;
      down = key !== "name";
    }
  }
</script>

{#if filterLabel != null}
  <label class="harbors-filter">
    {filterLabel}
    <input type="search" bind:value={query} autocomplete="off" />
  </label>
{/if}
<div class="harbors-scroll">
  <table class="harbors">
    {#if caption != null}
      <caption>{caption}</caption>
    {/if}
    <thead>
      <tr>
        {#each COLUMNS as column (column.key)}
          <th
            scope="col"
            aria-sort={by === column.key
              ? down
                ? "descending"
                : "ascending"
              : undefined}
            class={{ num: column.key !== "name" }}
          >
            <button type="button" onclick={() => sort(column.key)}>
              {column.label}
            </button>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each sorted as row (row.id)}
        <tr>
          <th scope="row">{row.name}</th>
          <td class="num">{row.arrivals.toLocaleString("en-US")}</td>
          <td class="num">{row.departures.toLocaleString("en-US")}</td>
          <td class="num">{row.cargo.toLocaleString("en-US")}</td>
          <td class="num">{row.onTime.toFixed(1)}%</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if sorted.length === 0}
    <p class="harbors-empty">No harbor matches “{query}”.</p>
  {/if}
</div>
