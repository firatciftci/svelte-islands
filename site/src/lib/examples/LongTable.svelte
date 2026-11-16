<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { Island, load, type Part, unroll } from "svelte-islands";
  import Coast from "#lib/components/Coast.svelte";
  import type { Harbor } from "#lib/harrow.js";

  type Column = "name" | "arrivals" | "departures" | "cargo" | "onTime";

  const CHUNK = 100;

  const COLUMNS: Array<{ key: Column; label: string }> = [
    { key: "name", label: "Berth" },
    { key: "arrivals", label: "Arrivals" },
    { key: "departures", label: "Departures" },
    { key: "cargo", label: "Cargo (kt)" },
    { key: "onTime", label: "On time" },
  ];

  let { parts }: { parts: { count: number; berths: Part<Array<Harbor>> } } =
    $props();

  const chunks = $derived(
    Array.from({ length: Math.ceil(parts.count / CHUNK) }, (_, at) => at),
  );
  const selected = new SvelteSet<number>();
  const shelf = unroll(CHUNK);

  let sorted = $state.raw<Array<Harbor> | null>(null);
  let by = $state<Column | null>(null);
  let down = $state(true);
  let isSorting = $state(false);

  async function sort(key: Column) {
    isSorting = true;
    const rows = await load(parts.berths);
    down = by === key ? !down : key !== "name";
    by = key;
    sorted = rows.toSorted((a, b) => {
      const order =
        key === "name" ? a.name.localeCompare(b.name) : a[key] - b[key];
      return down ? -order : order;
    });
    isSorting = false;
  }

  function choose(id: number, isChosen: boolean) {
    if (isChosen) {
      selected.add(id);
    } else {
      selected.delete(id);
    }
  }

  async function download() {
    const rows = await load(parts.berths);
    const lines = ["Berth,Arrivals,Departures,Cargo (kt),On time"];
    for (const row of rows) {
      lines.push(
        `${row.name},${row.arrivals},${row.departures},${row.cargo},${row.onTime}`,
      );
    }
    const url = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/csv" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "berths.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

{#snippet row(berth: Harbor)}
  <tr>
    <td>
      <input
        type="checkbox"
        aria-label={`Select ${berth.name}`}
        checked={selected.has(berth.id)}
        onchange={(event) => choose(berth.id, event.currentTarget.checked)}
      />
    </td>
    <th scope="row">{berth.name}</th>
    <td class="num">{berth.arrivals.toLocaleString("en-US")}</td>
    <td class="num">{berth.departures.toLocaleString("en-US")}</td>
    <td class="num">{berth.cargo.toLocaleString("en-US")}</td>
    <td class="num">{berth.onTime.toFixed(1)}%</td>
  </tr>
{/snippet}

<Coast seed={9}>
  <p class="coast-note">
    Three hundred berths in three tbody islands. Each island wakes on its own.
    Sorting downloads the data once and redraws the rows a few at a time.
  </p>
  <div class="berths-bar">
    <span>
      {selected.size === 0 ? "None selected" : `${selected.size} selected`}
    </span>
    <button type="button" onclick={download}>Download as CSV</button>
  </div>
  <div class="harbors-scroll berths-scroll">
    <table class="harbors berths" aria-busy={isSorting}>
      <thead>
        <tr>
          <td><span class="visually-hidden">Select</span></td>
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
      {#if sorted == null}
        {#each chunks as chunk (chunk)}
          <Island part={parts.berths} view={`chunk-${chunk}`} as="tbody">
            {#snippet children(berths)}
              {#each berths.slice(chunk * CHUNK, (chunk + 1) * CHUNK) as berth (berth.id)}
                {@render row(berth)}
              {/each}
            {/snippet}
          </Island>
        {/each}
      {:else}
        <tbody>
          {#each sorted.slice(0, shelf.limit) as berth (berth.id)}
            {@render row(berth)}
          {/each}
          {#if shelf.limit < sorted.length}
            <tr {@attach shelf.tail(sorted.length)}></tr>
          {/if}
        </tbody>
      {/if}
    </table>
  </div>
</Coast>
