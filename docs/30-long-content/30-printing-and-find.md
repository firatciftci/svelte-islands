---
title: Printing and find in page
---

Content that has not loaded still prints, and people can still find it. There's nothing you need to do for this to work.

## Printing

When the browser is about to print, each static island hydrates, each deferred island fetches its HTML, and each [`unroll` list](10-long-lists.md) renders every item.

Browsers do not wait for asynchronous work after `beforeprint`, so these steps use synchronous requests. This is the only time the library blocks the main thread on the network.

## Find in page

When someone presses Ctrl+F or Cmd+F, islands start loading as they would on scroll, and `unroll` lists keep growing, so their text becomes searchable.

This has a limit that we can't get around: choosing Find from the browser's menu sends the page no event, so the library can't react to it.

## Client-only islands

A client-only island has no server HTML and is often a map, so it only joins in if it has an [outline](../20-core-concepts/20-islands.md#screen-readers).

Maps with no headings never load because of printing or a search, and any skeleton left over is hidden on paper.

## Without JavaScript

Without JavaScript, `@media (scripting: none)` hides skeletons and shows outlines as plain headings, so your page does not need a `<noscript>` for them.

The content itself cannot arrive without JavaScript, so you should link to another copy of it if you have one.

## Your own lazy content

Your own lazy content can join in with `whenWanted`, which calls your function with `"print"` or `"find"` and returns a function that stops listening:

```svelte
<script>
  import { loadNow, whenWanted } from "svelte-islands";

  let { data } = $props();

  let rows = $state.raw(null);

  $effect(() => {
    return whenWanted((want) => {
      if (want === "print") {
        // the browser won't wait for a promise, so this has to be synchronous
        rows = loadNow(data.rows)?.value ?? null;
      }
    });
  });
</script>
```

You must do the work for `"print"` synchronously. `loadNow(part)` returns `{ value }` for a part, using a synchronous request if it has to, or `null` if the request fails.
