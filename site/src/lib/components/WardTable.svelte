<script lang="ts">
  import type { Ward } from "#lib/harrow.js";

  type Column = "name" | "tide" | "beacon" | "harbor" | "turnout";

  let {
    rows,
    limit = rows.length,
    caption,
    nameLabel = "Ward",
    filterLabel,
  }: {
    rows: Array<Ward>;
    limit?: number;
    caption?: string;
    nameLabel?: string;
    filterLabel?: string;
  } = $props();

  let by = $state<Column>("tide");
  let down = $state(true);
  let query = $state("");

  const COLUMNS: Array<{ key: Column; label: string }> = $derived([
    { key: "name", label: nameLabel },
    { key: "tide", label: "Tide" },
    { key: "beacon", label: "Beacon" },
    { key: "harbor", label: "Harbor" },
    { key: "turnout", label: "Turnout" },
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
  <label class="wards-filter">
    {filterLabel}
    <input type="search" bind:value={query} autocomplete="off" />
  </label>
{/if}
<div class="wards-scroll">
  <table class="wards">
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
            class:num={column.key !== "name"}
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
          <td class="num">{row.tide.toLocaleString("en-US")}</td>
          <td class="num">{row.beacon.toLocaleString("en-US")}</td>
          <td class="num">{row.harbor.toLocaleString("en-US")}</td>
          <td class="num">{row.turnout.toFixed(1)}%</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if sorted.length === 0}
    <p class="wards-empty">No district matches “{query}”.</p>
  {/if}
</div>
