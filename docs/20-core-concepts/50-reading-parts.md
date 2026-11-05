---
title: Reading parts
---

An `Island` is the usual way to read a part, but sometimes you need the value in a script. There are two ways to get it.

## `peek`

`peek(part)` returns `{ value }` if the part's data is already in memory, and `null` if it is not:

```svelte
<script>
  import { peek } from "svelte-islands";

  let { data } = $props();

  // `null` until the rows arrive, then an array
  const rows = $derived(peek(data.rows)?.value);
</script>

{#if rows}
  <p>{rows.length} rows</p>
{/if}
```

It's reactive, so a `$derived` that reads it updates when the data arrives. It does not start a download, though — something else has to do that.

(If all you need is a total or a count, consider computing it on the server and returning it from `load`. That way it is in the page from the start, and nobody has to download the rows to see it.)

## `load`

`load(part)` starts the download if it has not started yet, and returns a promise of the value:

```svelte
<script>
  import { load } from "svelte-islands";

  let { data } = $props();

  async function download() {
    const rows = await load(data.rows);
    // turn `rows` into a CSV and save it...
  }
</script>

<button onclick={download}>Download CSV</button>
```

This pairs well with `fetch: "lazy"`, for data you only want when someone asks for it.

You might be tempted to read `data.rows.loaded` instead, since it's right there. That value is only set where the part was made, so it is `null` in the browser for most parts. The [`no-loaded-in-client`](../50-tooling/20-eslint.md) ESLint rule catches this.

## Views

The same part can render in more than one way. If you give each rendering a `view`, each one gets its own [skeleton](40-skeletons.md):

```svelte
<Island part={data.rows} view="table">
  {#snippet children(rows)}
    <ResultsTable {rows} />
  {/snippet}
</Island>

<Island part={data.rows} view="chart" when="visible">
  {#snippet children(rows)}
    <ResultsChart {rows} />
  {/snippet}
</Island>
```

Both islands share one part, so the data downloads once. They wake separately, though, so if your chart wakes first, the table still stays static until someone touches it.

## Reading another part inside an island

An island can read parts other than its own. Your table might use `peek(data.parties)` for its colors, for example:

```svelte
<Island part={data.rows}>
  {#snippet children(rows)}
    <ResultsTable {rows} parties={peek(data.parties)?.value} />
  {/snippet}
</Island>
```

While the server renders an island, it records every other part the island reads. The browser then loads those with the island's own part before hydrating.

Without this, the island could render differently from the server's HTML, and Svelte would clear that block until the part arrived.
