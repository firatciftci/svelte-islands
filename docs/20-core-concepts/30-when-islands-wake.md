---
title: When islands wake
description: Choose when an island downloads its data and hydrates, with one strategy or several: on interaction, when it scrolls into view, when a media query matches, or never. Covers prefetching too.
---

An island _wakes_ when the browser downloads its data and hydrates it. You choose the moment with `hydrate`:

```svelte
<Island part={data.products} hydrate="visible">
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

The default is `interaction`, except for an island with `render="client"`, which defaults to `visible`. See [Islands](20-islands.md#client-only). With the [Vite plugin](70-vite-plugin.md#islands-that-never-hydrate), an island whose snippet can't change defaults to `never`.

Each of these islands uses a different one, so you can see what it takes to wake each:

<!-- example: strategies -->

## `interaction`

This is the default because it costs nothing until someone reaches for the island. Most of what's on a page gets read rather than used, so most islands on most visits will never wake.

Moving a pointer over the island is enough to start the download, which means the data is often in memory by the time the click lands. If the click gets there first, the island holds it and replays it, as described in [input before hydration](../20-core-concepts/60-clicks.md).

The page listens for this once, on the document, rather than once per island, so a page with hundreds of islands adds no listeners for them. A download that starts this way asks the browser for high priority, ahead of images and other low-priority requests, because someone is about to use the island.

## `visible`

You can use this for a chart or map that should be live as soon as someone can see it.

`margin` says how close to the viewport the island has to come, as a CSS margin. It defaults to `320px`, so that the work starts before the island scrolls into view:

```svelte
<Island part={data.sales} hydrate="visible" margin="600px">
  {#snippet children(sales)}
    <SalesChart {sales} />
  {/snippet}
</Island>
```

Islands with the same `margin` share one `IntersectionObserver`, so having a lot of them is cheap.

## `media`

Sometimes an island only has work to do at certain sizes (a sales chart in a sidebar that a phone never shows, for example):

```svelte
<Island part={data.sales} hydrate="media" media="(min-width: 64rem)">
  {#snippet children(sales)}
    <SalesChart {sales} />
  {/snippet}
</Island>
```

If the query never matches, the island never wakes, and that phone never downloads the data.

## `never`

Content that never responds to anything has no reason to hydrate. It stays as server HTML, and the browser never downloads its data.

You rarely need to write it: the [Vite plugin](70-vite-plugin.md#islands-that-never-hydrate) sets it for any island whose snippet can't change.

This paragraph is one of them.

## More than one strategy

`hydrate` also takes an array. The first strategy to fire wins, and the rest are dropped:

```svelte
<Island part={data.products} hydrate={["interaction", "idle"]}>
  {#snippet children(products)}
    <ProductTable {products} />
  {/snippet}
</Island>
```

This island wakes when someone touches it, or when the browser goes idle, whichever comes first.

## Changing `hydrate` after mount

You can change `hydrate` after the island has mounted. The usual reason is a control outside the island that needs it to be live, and switching to `eager` wakes it right away:

```svelte
<script>
  let isFiltering = $state(false);
</script>

<button onclick={() => (isFiltering = true)}>Filter</button>

<Island part={data.products} hydrate={isFiltering ? "eager" : "interaction"}>
  {#snippet children(products)}
    <ProductTable {products} {isFiltering} />
  {/snippet}
</Island>
```

## Prefetching

An island doesn't always have to wait for its data to arrive. With `prefetch` on, which is the default, an island whose part isn't in memory fetches it at low priority once the island comes near the viewport and the browser is idle. The data is often there by the time the island wakes. Set `prefetch={false}` to turn this off for one island.

Prefetching doesn't happen in a few cases:

- when `hydrate` includes `visible` or `eager`, since the island fetches its data then anyway
- when `hydrate` is only `never`, since the island never wakes
- when the reader has asked to save data with `Save-Data`, or the connection is `slow-2g` or `2g`, so that data the reader may never need doesn't use up a slow connection
- once the page has prefetched 1 MiB of parts, until the page is reloaded, so that a long page can't fetch everything up front

An island that's waiting for another strategy, such as `idle` or `media`, still notices a pointer, focus, or touch inside it. It starts downloading its data and code right then, at high priority, and wakes when its own strategy fires. To see how much prefetching helped, listen for the [`prefetch` event](../50-tooling/40-measuring.md), which says, for each part, whether an island used it, needed it before it arrived, or never read it.

## Several at once

When several islands are ready at the same time, they wake one after another in slices of about 8 ms, and the browser gets the main thread back between slices to handle input and paint.

They go in this order:

- islands that use `interaction`
- islands that use `visible` or `eager`
- islands that use `media`
- islands that use `idle`

An island with a held click moves to the front, because someone is waiting for it.

Islands that render in the browser (after a client-side navigation, or with `render="client"`) go through the same queue.
