---
title: A sortable table with thousands of rows
description: A worked example of an order history with 10,000 rows that people can sort, select, and export, built with islands, load, and unroll.
---

An order history for an online store can run to 10,000 rows, and the people who use it want to sort it, select a few orders, and export them. That is about the hardest thing to put on a page with islands, because the table needs its HTML in the page, its rows are too many to hydrate at once, and sorting touches every row.

This example combines three tools to handle it: [`as="tbody"`](../30-long-content/20-long-tables.md#near-the-top) islands for the rows, [`load`](../20-core-concepts/50-reading-parts.md#load) for the data, and [`unroll`](../30-long-content/10-long-lists.md) for redrawing it. The server side is short:

```ts
/// file: src/routes/admin/orders/+page.server.ts
import { part } from "svelte-islands/server";

export async function load() {
  const orders = await getOrders();

  return { count: orders.length, orders: part("admin.orders", orders) };
}
```

`count` travels as a plain number, because the page has to know how many rows there are before any of them have downloaded.

## Rows in chunks

The rows go in islands of 100, each one a `tbody`:

```svelte
<!--- file: src/routes/admin/orders/+page.svelte --->
<script>
  import { Island } from "svelte-islands";

  const CHUNK = 100;

  let { data } = $props();

  const chunks = $derived(
    Array.from({ length: Math.ceil(data.count / CHUNK) }, (_, at) => at),
  );
</script>

{#snippet row(order)}
  <tr>
    <td>{order.date}</td>
    <td>{order.customer}</td>
    <td class="num">{order.total.toFixed(2)}</td>
    <td>{order.status}</td>
  </tr>
{/snippet}

<table>
  <thead>
    <tr>
      <th scope="col">Date</th>
      <th scope="col">Customer</th>
      <th scope="col">Total</th>
      <th scope="col">Status</th>
    </tr>
  </thead>
  {#each chunks as chunk (chunk)}
    <Island part={data.orders} view={`chunk-${chunk}`} as="tbody">
      {#snippet children(orders)}
        {#each orders.slice(chunk * CHUNK, (chunk + 1) * CHUNK) as order (order.id)}
          {@render row(order)}
        {/each}
      {/snippet}
    </Island>
  {/each}
</table>
```

An island's wrapper is normally a `div`, which can't sit inside a `table`, and `as="tbody"` makes the wrapper a `tbody` instead. A table may hold any number of `tbody` elements, so to the browser this is still one table.

Every chunk reads the same part, so the orders download once, whichever chunk wakes first. Each chunk still needs its own `view`, because an island finds its server HTML by its part's name and its view, and chunks with the same pair would find each other's.

Each chunk wakes on its own, on the first pointer or focus inside it. That is the reason for the chunks: one island around 10,000 rows would hydrate all of them (tens of thousands of elements) the moment someone touched any row. A chunk hydrates only the 100 rows under the pointer.

## Selecting rows

The page keeps the selection in a `SvelteSet`, outside the islands:

```svelte
<!--- file: src/routes/admin/orders/+page.svelte --->
<script>
  import { SvelteSet } from "svelte/reactivity";
  import { Island } from "svelte-islands";

  // ...

  const selected = new SvelteSet();

  function choose(id, isChosen) {
    if (isChosen) {
      selected.add(id);
    } else {
      selected.delete(id);
    }
  }
</script>

<p>{selected.size} selected</p>

{#snippet row(order)}
  <tr>
    <td>
      <input
        type="checkbox"
        aria-label="Select order {order.id}"
        checked={selected.has(order.id)}
        onchange={(event) => choose(order.id, event.currentTarget.checked)}
      />
    </td>
    <td>{order.date}</td>
    <!-- ... -->
  </tr>
{/snippet}
```

The `row` snippet is defined in the page, so the islands that render it share the page's `selected`. A checkbox in a chunk updates the count outside it, and the count is live as soon as the page hydrates.

A click on a checkbox in a chunk that hasn't hydrated is [held and replayed](../20-core-concepts/60-clicks.md) once it has, so the first click is never lost.

## Sorting

Sorting is where a static island gets in the way. Until a chunk hydrates, it is server HTML and nothing about it is reactive, so you can't re-sort its rows in place. Hydrating it against a new order wouldn't work either, because its HTML would no longer match what it renders.

So the first sort downloads the orders with `load`, sorts them, and swaps every chunk for one `tbody` that the browser renders itself:

```svelte
<!--- file: src/routes/admin/orders/+page.svelte --->
<script>
  import { SvelteSet } from "svelte/reactivity";
  import { Island, load, unroll } from "svelte-islands";

  const CHUNK = 100;
  const COLUMNS = [
    { key: "date", label: "Date" },
    { key: "customer", label: "Customer" },
    { key: "total", label: "Total" },
    { key: "status", label: "Status" },
  ];

  let { data } = $props();

  const shelf = unroll(CHUNK);

  let sorted = $state.raw(null);
  let by = $state(null);
  let down = $state(true);
  let isSorting = $state(false);

  function compare(a, b) {
    return typeof a === "number" ? a - b : String(a).localeCompare(String(b));
  }

  async function sort(key) {
    isSorting = true;
    const orders = await load(data.orders);
    down = by === key ? !down : true;
    by = key;
    sorted = orders.toSorted((a, b) =>
      down ? compare(b[key], a[key]) : compare(a[key], b[key]),
    );
    isSorting = false;
  }

  // ...
</script>

<table aria-busy={isSorting}>
  <thead>
    <tr>
      <td></td>
      {#each COLUMNS as column (column.key)}
        <th
          scope="col"
          aria-sort={by === column.key
            ? down
              ? "descending"
              : "ascending"
            : undefined}
        >
          <button onclick={() => sort(column.key)}>{column.label}</button>
        </th>
      {/each}
    </tr>
  </thead>
  {#if sorted == null}
    {#each chunks as chunk (chunk)}
      <Island part={data.orders} view={`chunk-${chunk}`} as="tbody">
        {#snippet children(orders)}
          {#each orders.slice(chunk * CHUNK, (chunk + 1) * CHUNK) as order (order.id)}
            {@render row(order)}
          {/each}
        {/snippet}
      </Island>
    {/each}
  {:else}
    <tbody>
      {#each sorted.slice(0, shelf.limit) as order (order.id)}
        {@render row(order)}
      {/each}
      {#if shelf.limit < sorted.length}
        <tr {@attach shelf.tail(sorted.length)}></tr>
      {/if}
    </tbody>
  {/if}
</table>
```

The sort buttons are in the `thead`, outside every island, so they're live as soon as the page hydrates. The first press waits for the download, and `aria-busy` says so in the meantime. Later presses don't download anything, because `load` returns the value from memory once it has arrived.

Rendering 10,000 sorted rows at once would cost what the chunks were there to avoid, so the new `tbody` uses `unroll`. It starts at 100 rows and adds more each frame, in batches that take about 8 ms, while the empty tail row is within a screen's height of the viewport. The tail copies the shape of the row before it, so it looks like the next row while it waits, and screen readers skip it.

`sorted` is `$state.raw` rather than `$state`, since each sort replaces the whole array, and proxying 10,000 objects deeply would only slow things down.

The selection survives the swap, because it lives in the page. Anything kept _inside_ a row (an expanded detail panel, for example) does not, since the rows it lived in are gone.

## Exporting

`load` also serves an export button, and it shares the download with sorting:

```svelte
<script>
  async function download() {
    const orders = await load(data.orders);
    const lines = ["Date,Customer,Total,Status"];
    for (const order of orders) {
      // a real export should quote fields that contain commas
      lines.push(
        [order.date, order.customer, order.total, order.status].join(","),
      );
    }
    const url = URL.createObjectURL(
      new Blob([lines.join("\n")], { type: "text/csv" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "orders.csv";
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

<button onclick={download}>Download as CSV</button>
```

## Try it

The live version below has the same parts, with 300 rows in three chunks rather than 10,000, so that this page stays light. Point at a chunk to wake it, select a few rows, then sort by a column. Its source is in [`LongTable.svelte`](https://github.com/firatciftci/svelte-islands/blob/main/site/src/lib/examples/LongTable.svelte):

<!-- example: table -->

## Why not `defer`

A `tbody` island has nowhere to put a skeleton, since its wrapper is part of the table. So `as="tbody"` needs its rows in the page, and it throws an error if you combine it with `defer` or `ssr={false}`.

That's the right trade for a table near the top of the page. If yours starts below the fold, you can [defer the whole table](../30-long-content/20-long-tables.md#below-the-fold) instead, and keep its HTML out of the page until someone scrolls toward it.

## Rows with no controls

If the rows have no checkboxes or buttons, they never need to hydrate. Make the rows one island with `when="never"`:

```svelte
<Island part={data.orders} as="tbody" when="never">
  {#snippet children(orders)}
    {#each orders as order (order.id)}
      {@render row(order)}
    {/each}
  {/snippet}
</Island>
```

The chunks are gone, since nothing will ever hydrate. The orders don't download at all unless someone sorts or exports, and `load` fetches them then.

## Printing and find in page

Both work with no extra code. The chunks' HTML is in the page from the start, and before printing each static chunk hydrates. After a sort, the `unroll` list renders every row when the browser is about to print, and keeps growing when someone presses Ctrl+F or Cmd+F, so their text becomes searchable ([more on this](../30-long-content/30-printing-and-find.md)).

## Limits

- every row's HTML is still in the page, which is what lets the table show without JavaScript and appear to crawlers; check the page's weight with the [budget check](../50-tooling/10-budget-check.md), and if it's too heavy, paginate on the server or defer the table
- the first sort has to wait for the download, so a slow connection feels it, and you'll want to show the busy state
- after a sort, rows below `shelf.limit` aren't in the page until the reader scrolls toward them, so choosing Find from the browser's menu (which sends the page no event) can't reach them
- the swap starts the new `tbody` at 100 rows, so if someone sorts from deep in a long table with a sticky header, the table gets shorter under them, and you may want to scroll its top into view after a sort
