---
title: When islands wake
---

An island _wakes_ when the browser downloads its data and hydrates it. You choose the moment with `when`:

```svelte
<Island part={data.products} when="visible">
  {#snippet children(products)}
    <ProductTable {products} />
  {/snippet}
</Island>
```

There are six strategies:

- `interaction` (the default) wakes on the first pointer, focus, or touch inside the island
- `visible` wakes when the island comes within `margin` of the viewport
- `idle` wakes when the browser is idle
- `media` wakes when the `media` query matches
- `eager` wakes right away
- `never` stays as server HTML

Each of these islands uses a different one, so you can see what it takes to wake each:

<!-- example: strategies -->

## `interaction`

This is the default because it costs nothing until someone reaches for the island. Most of what's on a page gets read rather than used, so most islands on most visits will never wake.

Moving a pointer over the island is enough to start the download, which means the data is often in memory by the time the click lands. If the click gets there first, the island holds it and replays it, as described in [clicks before hydration](../20-core-concepts/60-clicks.md).

## `visible`

You can use this for a chart or map that should be live as soon as someone can see it.

`margin` says how close to the viewport the island has to come, as a CSS margin. It defaults to `320px`, so that the work starts before the island scrolls into view:

```svelte
<Island part={data.sales} when="visible" margin="600px">
  {#snippet children(sales)}
    <SalesChart {sales} />
  {/snippet}
</Island>
```

Islands with the same `margin` share one `IntersectionObserver`, so having a lot of them is cheap.

## `media`

Sometimes an island only has work to do at certain sizes (a sales chart in a sidebar that a phone never shows, for example):

```svelte
<Island part={data.sales} when="media" media="(min-width: 64rem)">
  {#snippet children(sales)}
    <SalesChart {sales} />
  {/snippet}
</Island>
```

If the query never matches, the island never wakes, and that phone never downloads the data.

## `never`

Content that never responds to anything has no reason to hydrate. It stays as server HTML, and the browser never downloads its data.

The text you're reading is one of these.

## Changing `when` after mount

You can change `when` after the island has mounted. The usual reason is a control outside the island that needs it to be live, and switching to `eager` wakes it right away:

```svelte
<script>
  let isFiltering = $state(false);
</script>

<button onclick={() => (isFiltering = true)}>Filter</button>

<Island part={data.products} when={isFiltering ? "eager" : "interaction"}>
  {#snippet children(products)}
    <ProductTable {products} {isFiltering} />
  {/snippet}
</Island>
```

## Several at once

When several islands are ready at the same time, they wake one after another in slices of about 8 ms, and the browser gets the main thread back between slices to handle input and paint.

They go in this order:

- islands that use `interaction`
- islands that use `visible` or `eager`
- islands that use `media`
- islands that use `idle`

An island with a held click moves to the front, because someone is waiting for it.

Islands that render in the browser (after a client-side navigation, or with `ssr={false}`) go through the same queue.
