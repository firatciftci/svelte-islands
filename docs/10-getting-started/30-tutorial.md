---
title: Tutorial
description: Build a page that lists 5,000 products as plain SvelteKit, then move it to islands one step at a time and measure the difference.
---

Let's build a page that lists 5,000 products, first as an ordinary SvelteKit page and then with islands, one change at a time. You'll need an app with the library [set up](20-setup.md), and about twenty minutes.

Each step leaves the page working, so you can stop at any point and keep what you have.

## Some data to work with

We need a lot of rows, and we don't want to set up a database to get them. Add a module that makes them up:

```ts
/// file: src/lib/server/catalog.ts
export type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  stock: number;
};

const NAMES = ["Linen shirt", "Wool scarf", "Canvas tote", "Oak stool"];
const CATEGORIES = ["Clothing", "Home", "Kitchen"];

export async function getProducts(): Promise<Array<Product>> {
  const products: Array<Product> = [];
  for (let id = 1; id <= 5000; id += 1) {
    products.push({
      id,
      name: `${NAMES[id % NAMES.length]} ${id}`,
      category: CATEGORIES[id % CATEGORIES.length] ?? "Home",
      price: 500 + ((id * 7919) % 20000),
      stock: (id * 31) % 120,
    });
  }
  return products;
}
```

Prices are in cents so that the arithmetic stays exact.

## The plain page

Start with the page you would write without the library. The `load` function returns the products...

```ts
/// file: src/routes/products/+page.server.ts
import { getProducts } from "#lib/server/catalog.js";

export async function load() {
  return { products: await getProducts() };
}
```

...and a component draws them as a table, with a button that sorts by price:

```svelte
<!--- file: src/routes/products/ProductTable.svelte --->
<script lang="ts">
  import type { Product } from "#lib/server/catalog.js";

  let { products }: { products: Array<Product> } = $props();

  let isCheapestFirst = $state(false);

  const shown = $derived(
    isCheapestFirst ? products.toSorted((a, b) => a.price - b.price) : products,
  );
</script>

<table class="products">
  <thead>
    <tr>
      <th scope="col">Product</th>
      <th scope="col">Category</th>
      <th scope="col">
        <button onclick={() => (isCheapestFirst = !isCheapestFirst)}>
          Price
        </button>
      </th>
      <th scope="col">In stock</th>
    </tr>
  </thead>
  <tbody>
    {#each shown as product (product.id)}
      <tr class="product">
        <td class="name">{product.name}</td>
        <td>{product.category}</td>
        <td class="price">${(product.price / 100).toFixed(2)}</td>
        <td>{product.stock}</td>
      </tr>
    {/each}
  </tbody>
</table>
```

The type import is erased when the component compiles, so nothing from `#lib/server` reaches the browser.

The page puts the two together:

```svelte
<!--- file: src/routes/products/+page.svelte --->
<script lang="ts">
  import ProductTable from "./ProductTable.svelte";

  let { data } = $props();
</script>

<h1>Products</h1>
<p>{data.products.length} products</p>

<ProductTable products={data.products} />
```

Open `/products` and you will see the table. It works, and on a fast laptop it might even feel fine.

## Measuring where we started

Before changing anything, write down what the page weighs so that you can tell what each step does. Add a budget file...

```json
/// file: islands.budget.json
{
  "limits": { "raw": 400, "gzip": 60, "inline": 150 },
  "pages": { "/products": {} }
}
```

...then build the app, start `vite preview`, and run [the check](../50-tooling/10-budget-check.md) against it:

```sh
npx svelte-islands check http://localhost:4173
```

Expect `raw` to be well over its limit, since every product is in the HTML as a table row (more than 500 KiB of them). `inline` will be large too, because every product is in the page a second time, as data in an inline script, so that the page can hydrate.

Keep the output somewhere. We'll run the same command at the end.

## Making a part

The data is the heavier copy, and nobody needs it until they sort. Wrap it in `part`, and give it a name:

```ts
/// file: src/routes/products/+page.server.ts
+++import { part } from "svelte-islands/server";+++
import { getProducts } from "#lib/server/catalog.js";

export async function load() {
---  return { products: await getProducts() };---
+++  const products = await getProducts();
  return {
    count: products.length,
    products: part("catalog.products", products),
  };+++
}
```

`data.products` is now a [_part_](../20-core-concepts/10-parts.md): a small object with a name, a hash of the contents, and a size. The products themselves will live at their own URL, named by that hash.

We've also returned the count as its own value. The page needs it right away, and it shouldn't have to download 5,000 products to print one number.

If you run `svelte-check` now, it will flag the page, because `data.products.length` and `products={data.products}` both expected an array. We'll fix those next.

## Rendering it in an island

Replace the table with an `Island`, which hands the part's value to its snippet:

```svelte
<!--- file: src/routes/products/+page.svelte --->
<script lang="ts">
+++  import { Island } from "svelte-islands";+++
  import ProductTable from "./ProductTable.svelte";

  let { data } = $props();
</script>

<h1>Products</h1>
---
<p>{data.products.length} products</p>
--- +++
<p>{data.count} products</p>
+++ ---<ProductTable products={data.products} />--- +++<Island
  part={data.products}
>
  {#snippet children(products)}
    <ProductTable {products} />
  {/snippet}
</Island>+++
```

This is an [_island_](../20-core-concepts/20-islands.md): a region of the page that loads and hydrates on its own.

Reload the page with your browser's network panel open. The table is there, rendered on the server as before, but there is no request for its data yet. Now move your pointer over the table. You'll see a request to `/_parts/` followed by the table becoming interactive, because by default an island [wakes](../20-core-concepts/30-when-islands-wake.md) on the first interaction.

Try clicking Price before anything has loaded, too. The island holds on to the click, hydrates, and then [replays it](../20-core-concepts/60-clicks.md), so the sort still happens.

## Showing that it isn't live yet

Until the island wakes, a click on Price has to wait for the data and the code to arrive. It's usually a fraction of a second, but on a slow connection someone could notice. The island's wrapper says what state it's in, so you can fade the button until the table can respond:

```svelte
<!--- file: src/routes/products/+page.svelte --->
<Island part={data.products} class="catalog">
  {#snippet children(products)}
    <ProductTable {products} />
  {/snippet}
</Island>

<style>
  :global(.catalog[data-island-state="static"] th button) {
    opacity: 0.6;
  }
</style>
```

The state is `static` until the island wakes and `live` after it, and [Styling](../60-best-practices/20-styling.md#selecting-islands) lists the other two, for deferred and client-only islands.

## Rendering fewer rows at first

The data waits now, but 5,000 rows are still in the HTML, and when someone sorts, all 5,000 have to hydrate at once. Most people will never scroll past the first screen.

`unroll` renders a long list a few rows at a time, as the reader scrolls toward the end of it. Change the component to slice its rows, and put an empty row after the last one:

```svelte
<!--- file: src/routes/products/ProductTable.svelte --->
<script lang="ts">
+++  import { unroll } from "svelte-islands";+++
  import type { Product } from "#lib/server/catalog.js";

  let { products }: { products: Array<Product> } = $props();

  let isCheapestFirst = $state(false);
+++  const shelf = unroll(100);+++

  const shown = $derived(
    isCheapestFirst ? products.toSorted((a, b) => a.price - b.price) : products,
  );
</script>

<table class="products">
  <!-- ... -->
  <tbody>
---    {#each shown as product (product.id)}---
+++    {#each shown.slice(0, shelf.limit) as product (product.id)}+++
      <tr class="product">
        <!-- ... -->
      </tr>
    {/each}
+++    {#if shelf.limit < shown.length}
      <tr {@attach shelf.tail(shown.length)}></tr>
    {/if}+++
  </tbody>
</table>
```

The server now renders 100 rows. In the browser, the empty row shows a skeleton of the row above it, and when it comes near the screen, `limit` grows by as many rows as fit in about 8 ms per frame. [Long lists](../30-long-content/10-long-lists.md) has the details.

There is a catch, though. The empty row can only grow the list once the island is live, and right now the island waits for a pointer. Someone who scrolls with a trackpad, without ever touching the table, would reach the end of row 100 and find a skeleton that never fills in.

So the island should wake when it comes into view instead:

```svelte
<!--- file: src/routes/products/+page.svelte --->
---<Island part={data.products} class="catalog">---
+++<Island part={data.products} class="catalog" when="visible">+++
  {#snippet children(products)}
    <ProductTable {products} />
  {/snippet}
</Island>
```

This is the usual pairing: `unroll` keeps the first render short, and `when="visible"` makes sure the island is awake before anyone gets to the end of it.

This has a trade-off. Our table is at the top of the page, so `visible` wakes it soon after the page loads, and the data now downloads on almost every visit. It still arrives after the page has painted, from a URL the browser can cache, and only 100 rows hydrate instead of 5,000. A table further down the page would keep waiting until someone scrolled to it.

Finding text in the page and printing still see every product, because both bring in the rest of the list. [Printing and find in page](../30-long-content/30-printing-and-find.md) explains how.

## When the data can't arrive

A download can fail, and with nothing else in place, the island shows a plain Retry button where its content would be. You can say something more useful with a `failed` snippet:

```svelte
<!--- file: src/routes/products/+page.svelte --->
<Island part={data.products} class="catalog" when="visible">
  {#snippet children(products)}
    <ProductTable {products} />
  {/snippet}

  {#snippet failed(retry)}
    <p>The products didn't load. <button onclick={retry}>Try again</button></p>
  {/snippet}
</Island>
```

This only shows when the island has nothing to fall back on (after a client-side navigation, for example). On a first load, the server's HTML is already in the page, so the table stays readable even if its data never arrives.

## Skeletons

Link to `/products` from another page in your app, and follow the link. There is no server HTML on a client-side navigation (only the data comes from the server), so the island shows a [_skeleton_](../20-core-concepts/40-skeletons.md) until the data arrives: bars where the text will be, laid out by your own CSS.

You didn't write that skeleton. The library learned it from what the island rendered, under the name `catalog.products`, which is why [part names](../20-core-concepts/10-parts.md#names) should stay stable. If neither the server nor the browser has seen the island render yet, there's nothing to go on, so you'll see a plain placeholder instead.

## Measuring again

Build the app, start `vite preview`, and run the check again:

```sh
npx svelte-islands check http://localhost:4173
```

Compare it with the output you kept. `raw` and `gzip` have dropped because the HTML holds 100 rows instead of 5,000, and `inline` has dropped because the products aren't in the page's data anymore.

To keep it that way, leave the budget file in your project and run the check in CI. The [overlay](../50-tooling/30-overlay.md) shows the same page from the inside while you work on it:

```svelte
<!--- file: src/routes/+layout.svelte --->
<script>
  import { dev } from "$app/env";
  import Devtools from "svelte-islands/devtools";

  let { children } = $props();
</script>

{@render children()}

{#if dev}
  <Devtools />
{/if}
```

## Where to go next

That's most of what you'll use day to day. From here:

- the [core concepts](../20-core-concepts/10-parts.md) explain each piece in more depth
- [Comments under a post](../35-examples/10-comments.md) and the other [examples](../35-examples/20-dashboard.md) build whole pages, from a comment thread up to an app running on several servers
- [Moving a page to islands](../70-appendix/10-migrating.md) is the checklist version of this tutorial, for a page you already have
