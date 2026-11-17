---
title: Reading parts
description: Read a part's value in a script instead of an Island. Use peek for data already in memory and load for data that still has to download.
---

An `Island` is the usual way to read a part, but sometimes you need the value in a script. There are two ways to get it.

## `peek`

`peek(part)` returns `{ value }` if the part's data is already in memory, and `null` if it is not:

```svelte
<script>
  import { peek } from "svelte-islands";

  let { data } = $props();

  // `null` until the products arrive, then an array
  const products = $derived(peek(data.products)?.value);
</script>

{#if products}
  <p>{products.length} products</p>
{/if}
```

It's reactive, so a `$derived` that reads it updates when the data arrives. It does not start a download, though; something else has to do that.

(If all you need is a total or a count, consider computing it on the server and returning it from `load`. That way it is in the page from the start, and nobody has to download the products to see it.)

## `load`

`load(part)` starts the download if it has not started yet, and returns a promise of the value:

```svelte
<script>
  import { load } from "svelte-islands";

  let { data } = $props();

  async function download() {
    const products = await load(data.products);
    // turn `products` into a CSV and save it...
  }
</script>

<button onclick={download}>Download CSV</button>
```

This pairs well with `fetch: "lazy"`, for data you only want when someone asks for it.

You might be tempted to read `data.products.loaded` instead, since it's right there. That value is only set where the part was made, so it is `null` in the browser for most parts. The [`no-loaded-in-client`](../50-tooling/20-eslint.md) ESLint rule catches this.

## Views

The same part can render in more than one way. If you give each rendering a `view`, each one gets its own [skeleton](40-skeletons.md):

```svelte
<Island part={data.products} view="table">
  {#snippet children(products)}
    <ProductTable {products} />
  {/snippet}
</Island>

<Island part={data.products} view="chart" hydrate="visible">
  {#snippet children(products)}
    <ProductChart {products} />
  {/snippet}
</Island>
```

Both islands share one part, so the data downloads once. They wake separately, though, so if your chart wakes first, the table still stays static until someone touches it.

## Reading another part inside an island

An island can read parts other than its own. Your table might use `peek(data.categories)` for its labels, for example:

```svelte
<Island part={data.products}>
  {#snippet children(products)}
    <ProductTable {products} categories={peek(data.categories)?.value} />
  {/snippet}
</Island>
```

While the server renders an island, it records every other part the island reads. The browser then loads those with the island's own part before hydrating.

Without this, the island could render differently from the server's HTML, and Svelte would clear that block until the part arrived.
