---
title: A dashboard
description: A worked example of a store dashboard with a chart, a long table, a sidebar, and a map, each in an island that wakes at its own moment.
---

A dashboard puts several heavy things on one page (a chart at the top, a long table, a sidebar, a map), and each of them is needed at a different moment. Islands let you decide that moment one region at a time.

This example builds the dashboard of an online store. Its server `load` function makes one part for each heavy value, and computes the totals itself:

```ts
/// file: src/routes/dashboard/+page.server.ts
import { part } from "svelte-islands/server";

export async function load() {
  const [revenue, orders, categories, stores] = await Promise.all([
    getRevenue(),
    getOrders(),
    getCategories(),
    getStores(),
  ]);

  let total = 0;
  for (const order of orders) {
    total += order.total;
  }

  return {
    totals: { revenue: total, orders: orders.length, stores: stores.length },
    revenue: part("dashboard.revenue", revenue, { fetch: "preload" }),
    orders: part("dashboard.orders", orders),
    categories: part("dashboard.categories", categories),
    stores: part("dashboard.stores", stores),
  };
}
```

## Totals

The numbers across the top of a dashboard are what people look at first, and they are small. So they are plain values and not parts:

```svelte
<!--- file: src/routes/dashboard/+page.svelte --->
<script>
  import { Island, peek } from "svelte-islands";
  import CategoryChart from "./CategoryChart.svelte";
  import OrderChart from "./OrderChart.svelte";
  import OrderTable from "./OrderTable.svelte";
  import RevenueChart from "./RevenueChart.svelte";
  import StoreMap from "./StoreMap.svelte";

  let { data } = $props();
</script>

<dl class="totals">
  <dt>Revenue</dt>
  <dd>{data.totals.revenue.toLocaleString("en-US")}</dd>
  <dt>Orders</dt>
  <dd>{data.totals.orders.toLocaleString("en-US")}</dd>
  <dt>Stores</dt>
  <dd>{data.totals.stores}</dd>
</dl>
```

If the page computed them in the browser, every visitor would have to download every order to see one number. Computing them in `load` puts them in the page from the start, and they hydrate with it.

## The chart at the top

The revenue chart sits at the top, and people expect to point at it right away, so it wakes as soon as it's visible:

```svelte
<Island part={data.revenue} hydrate="visible">
  {#snippet children(revenue)}
    <RevenueChart {revenue} />
  {/snippet}
</Island>
```

On its own, `hydrate="visible"` would wait for your JavaScript to load before it asked for the data. That's why the part uses `fetch: "preload"`: the download starts as soon as the page arrives. On a first page load the library adds a `<link rel="preload">` to the head, so the browser fetches the data alongside your code rather than after it.

We recommend `preload` only for data near the top that's too big to [stay in the page](../20-core-concepts/10-parts.md#small-parts-stay-in-the-page). Preloading everything brings back the cost you made parts to avoid.

## One part, two views

The orders appear twice: as a chart of orders by day, and as a table. Both read the same part, and each has its own `view`...

```svelte
<Island part={data.orders} view="chart" hydrate="visible">
  {#snippet children(orders)}
    <OrderChart {orders} />
  {/snippet}
</Island>

<Island part={data.orders} view="table" class="orders">
  {#snippet children(orders)}
    <OrderTable {orders} categories={peek(data.categories)?.value ?? []} />
  {/snippet}
</Island>
```

...so the orders download once, but the islands still wake separately. When the chart scrolls into view, it downloads the orders and hydrates. The table stays static (still server HTML, with no code running) until someone reaches for it. [Views](../20-core-concepts/50-reading-parts.md#views) also give each island its own learned skeleton, since a chart and a table look nothing alike.

The same arrangement, with a smaller data set, looks like this. Scroll the chart into view first, then point at the table:

<!-- example: dashboard -->

## Reading another part

The table shows each order's category by name, and the names live in another part. It reads them with `peek`, which returns `null` if a part's data isn't in memory yet.

While the server renders an island, it records every other part the island reads. So the browser knows that the table [needs `data.categories`](../20-core-concepts/50-reading-parts.md#reading-another-part-inside-an-island), and loads it along with the orders before it hydrates the table.

Without that, the table would hydrate with no categories and render differently from its server HTML, and Svelte would clear it until the names arrived. If `data.categories` is small enough to stay in the page, there's nothing to load, and this costs nothing.

## The sidebar

The sidebar holds a chart of sales by category, and on a phone the sidebar is hidden. Use `hydrate="media"` with the same media query as your CSS...

```svelte
<aside class="sidebar">
  <Island part={data.categories} hydrate="media" media="(min-width: 64rem)">
    {#snippet children(categories)}
      <CategoryChart {categories} />
    {/snippet}
  </Island>
</aside>
```

...and the chart never wakes on a phone. Its server HTML is still in the page, because the island is static. If that HTML is large, you can keep it out as well with [`render="deferred"`](../20-core-concepts/20-islands.md#deferred).

## The map

A map usually can't render on the server, since map libraries tend to reach for `window` and draw into a `<canvas>`. So the map is a [client-only island](../20-core-concepts/20-islands.md#client-only):

```svelte
<div class="map">
  <Island part={data.stores} render="client" margin="600px">
    {#snippet children(stores)}
      <StoreMap {stores} />
    {/snippet}
  </Island>
</div>

<style>
  .map {
    block-size: 24rem;
  }
</style>
```

A client-only island wakes on `visible` by default, and `margin="600px"` starts the work further ahead of the viewport than the usual `320px`, because a map has a lot to download before it can draw.

The island's wrapper has `display: contents`, so it has no box of its own. The `div` around it holds the map's height, so nothing on the page moves when the map replaces its skeleton.

If your map library touches `window` as soon as it's imported, import it inside an effect:

```svelte
<!--- file: src/routes/dashboard/StoreMap.svelte --->
<script>
  let { stores } = $props();

  let container;

  $effect(() => {
    let map = null;
    import("./map.js").then(({ drawMap }) => {
      map = drawMap(container, stores);
    });
    return () => map?.remove();
  });
</script>

<div bind:this={container} style="block-size: 100%"></div>
```

The server still renders the island now and then to learn its skeleton. If that render throws, the island falls back to a generic skeleton, which is fine for a map.

## Which wakes first

When several islands are ready at the same time, they [wake one after another](../20-core-concepts/30-when-islands-wake.md#several-at-once) in slices of about 8 ms, so the page stays responsive while they do. Islands waiting on `interaction` go first, then `visible` and `eager`, then `media`, then `idle`.

On this dashboard, a first visit goes something like this:

- the totals hydrate with the page
- the revenue chart wakes as soon as its preloaded data is there
- the orders chart wakes when it nears the viewport, and downloads the orders for both views
- the category chart wakes after them on a wide screen, and never on a phone
- the map wakes when someone scrolls within 600 pixels of it
- the table wakes when someone reaches for it

A click held by an island goes to the front of the queue, because someone is waiting for it.

## Controls that aren't live yet

The table's sort buttons are in the page before the table hydrates. A click on one is [held and replayed](../20-core-concepts/60-clicks.md), so it works, but the first press can take a moment while the orders download.

You can hint at that with `data-island-state`, which the wrapper carries on a first page load. `class="orders"` on the table's island gives you something to select:

```css
/// file: src/app.css
.orders[data-island-state="static"] th button {
  cursor: progress;
}
```

The state is `static`, `deferred`, `client`, `fresh`, or `live` ([more on styling](../60-best-practices/20-styling.md#selecting-islands)). After a client-side navigation there is no server HTML to adopt, so the attribute is not there at all.

## What you'd change

- if the table is the first thing people use, you can wake it early with `hydrate="idle"`, or with `hydrate="eager"` from a control outside it ([changing `hydrate` after mount](../20-core-concepts/30-when-islands-wake.md#changing-hydrate-after-mount))
- if the dashboard differs per visitor (a store manager's own branch, for example), every part needs `private: true`, which keeps them in the page's data ([private data](../60-best-practices/10-private-data.md))
- if the table runs to thousands of rows, see [a sortable table with thousands of rows](30-sortable-table.md)
- if a value is slow to compute, you can [stream it](../20-core-concepts/45-streaming.md) instead of waiting for it in `load`
