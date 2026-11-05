---
title: Long lists
---

An island delays the cost of a long list, but it does not reduce it. Once it wakes, 10,000 items still have to render. `unroll` renders them a piece at a time instead:

```svelte
<script>
  import { unroll } from "svelte-islands";

  let { rows } = $props();

  const shelf = unroll(50);
</script>

<ol>
  {#each rows.slice(0, shelf.limit) as row (row.id)}
    <li>{row.name}</li>
  {/each}

  {#if shelf.limit < rows.length}
    <li {@attach shelf.tail(rows.length)}></li>
  {/if}
</ol>
```

`limit` starts at the number you pass to `unroll`, and that's how many items the server renders. You slice your list to it, and put an empty element right after the last item, with `tail(total)` attached.

When that element is on screen, or within a screen's height below it, `limit` grows by a few items each frame until the element moves out of range or `limit` reaches `total`.

## What it does for you

- the number of items per frame adapts so that rendering them takes about 8 ms, which leaves the browser time to respond to input
- the tail copies the class and shape of the item before it, so it shows a skeleton of the next item until that item renders
- the tail is hidden from screen readers
- growth stops once the tail scrolls above the screen, so that the list does not push down what someone is reading below it in a browser without scroll anchoring

Find in page and printing bring in the rest of the list, as described in [printing and find in page](30-printing-and-find.md).

## Compared with virtualization

A virtual list keeps only the visible rows in the DOM, which means it can handle far more items than this. It also means the browser can't find, select, or print the rows it has removed, and that each row needs a known height or a measurement.

`unroll` keeps everything it has rendered. So we recommend it for lists in the hundreds or low thousands, where people mostly read from the top. If someone might really scroll through 100,000 rows, you'll want a virtual list inside your island.

## With an island

The two work together. The island keeps the data out of your page until it's needed, and `unroll` keeps the first render short when it wakes:

```svelte
<Island part={data.rows} when="visible">
  {#snippet children(rows)}
    <Rows {rows} />
  {/snippet}
</Island>
```

Here `Rows` is the component from the top of this section, and the server renders its first 50 items into the island's HTML.
