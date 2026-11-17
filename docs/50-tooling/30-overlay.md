---
title: Overlay
description: Render Devtools in development to see every island on your page with its state, sizes, and timings, to spot failed downloads, and to find page data that's too large.
---

Render `Devtools` in development to see every island on your page, with its state, sizes, and timings:

```svelte
<!--- file: src/routes/+layout.svelte --->
<script>
  import { dev } from "$app/env";
  import Devtools from "svelte-islands/devtools";
</script>

{#if dev}
  <Devtools />
{/if}
```

Open the overlay with its Islands button. It flags four things:

- failed downloads
- parts over 256 KiB
- skeletons that were off by more than 16 pixels, so the page moved when the content arrived
- islands with no learned skeleton yet, which show a plain placeholder

You can change the limits with the `large`, `shift`, and `advise` props:

```svelte
<Devtools large={512} shift={8} advise={8} />
```

## The island table

Each island gets a row, with these columns:

- Data: the size of its part
- State: where its HTML came from
- Code: the size of its own chunk, when the Vite plugin split it out
- HTML: the size of its HTML, in KiB, counted in characters
- Load: how long the part took to download and decode
- Hydrate: how long hydration took
- Wait: the time from the first press, focus, or touch on the island to its going live, blank when nobody touched it first
- Height change: how far the skeleton moved, in pixels

Code is blank for an island with no chunk of its own, and also when the browser doesn't report a size for the chunk. The [Vite plugin](../20-core-concepts/70-vite-plugin.md) page explains the chunks.

## Page data

The overlay also sizes each value in your page's `data`. A value that isn't a part and is over `advise` KiB (4 by default) is marked, with a note that it travels in every page load. Make it a part with `part()`, and it loads with its island.

A plain object over the limit lists its own values too, so you can see which one is large. A value that's already a part counts only its reference, which is why parts stay small in this table.

The Islands button also shows a count of things to check: flagged islands plus large page data values.
