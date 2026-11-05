---
title: How it works
---

You don't need any of this to use the library, but it helps if you're debugging something (or you're just curious).

## On the server

`part` serializes the value, hashes the result, and keeps the text in memory and in your [store](../40-build-and-deploy/20-stores.md). A part of 4,096 characters or less goes into the page instead.

Deferred HTML is stored the same way, at `/_parts/<hash>.html`.

## Rebuilds and retries

If a part or deferred HTML is requested after the server no longer has it, the browser asks again with the page it came from, and the server reruns that page to recover it. If the data has changed since, the page reloads its data.

A failed fetch is retried after 1, 3, and 5 seconds before the island shows its failure state. A part the server can no longer rebuild is not retried.

## Learned skeletons

The server turns each island's rendered HTML into a skeleton made of bars and blocks. The browser does the same from the live DOM, saving what it learns in `localStorage`.

`Await` also renders its children on the server once its promise resolves, and learns from that HTML. So later visitors get a skeleton based on a server render that waited for the data.

## Part needs

While the server renders an island, it records every other part the island reads, and writes the ones that are not inlined to `data-island-needs`. The browser loads them with the island's own part before it hydrates.

Without this, the island could render differently from the server's HTML, and Svelte would clear that block until the part arrived.

## Shared observers

Islands with the same `margin` share one `IntersectionObserver`, so a page with hundreds of islands does not need hundreds of observers.

## Scheduled hydration

When several islands are ready at once, they hydrate one after another in slices of about 8 ms, and the browser gets the main thread back between slices to handle input and paint.

Islands that hydrate on interaction go first, then `visible` and `eager` islands, then `media` islands, then `idle` ones. An island with a held click moves to the front.

Islands that render in the browser (after a client-side navigation, or with `ssr={false}`) go through the same queue.

## Compact transport

If a part's value is plain data (objects, arrays, strings, numbers, booleans, `null`, and `undefined`), it is sent as packed JSON, in which:

- arrays of objects with the same keys are sent as columns
- repeated values, small objects, and lists are stored once and referred to by index
- runs of consecutive integers are sent as ranges
- arrays that are mostly zeros or nulls are sent as the positions of the other values

Arrays inside page data are packed the same way.

Anything else (dates, maps, nested objects referenced from more than one place) is sent in devalue's format.

There's one catch: a small object of plain values referenced from several places arrives as separate copies, so you should not rely on their identity.

On electionsarchive.com's pages, packed parts were 3 to 7 times smaller than devalue's output, and about half the size after gzip.
