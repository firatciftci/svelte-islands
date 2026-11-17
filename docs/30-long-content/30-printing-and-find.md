---
title: Printing and find in page
description: Islands that haven't loaded still print, and find in page still finds their text. Covers how that works and how to do the same for your own lazy content.
---

Most content that hasn't loaded yet still prints, and people can still find it. Islands handle both for you, with one exception: a client-only island prints only if its code has already loaded.

## Printing

When the browser is about to print, each deferred island fetches its HTML, and each [`unroll` list](10-long-lists.md) renders every item. A static island needs nothing, because its HTML is already in the page.

Browsers do not wait for asynchronous work after `beforeprint`, so the library uses synchronous requests for these steps. Those requests block the page until they finish, so a page with many deferred islands can pause briefly before it prints.

## Find in page

When someone presses Ctrl+F or Cmd+F, islands start loading as they would on scroll, and `unroll` lists keep growing, so their text becomes searchable.

This has a limit that we can't get around: choosing Find from the browser's menu sends the page no event, so the library can't react to it.

## Client-only islands

A client-only island has no server HTML, and it is often a map. Printing does not load its code. An island whose code hasn't loaded prints nothing: its skeleton is hidden on paper, and its [outline](../20-core-concepts/20-islands.md#screen-readers) is visually hidden. If its code has already loaded, printing renders it, fetching its data synchronously if it has to.

A search doesn't load it either, unless it has an outline. So a map with no headings never loads for printing or find in page.

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
