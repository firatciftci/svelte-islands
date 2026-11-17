---
title: How it works
description: What svelte-islands does on the server and in the browser: content-addressed parts, rebuilds, learned skeletons, and scheduled hydration.
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

Islands that render in the browser (after a client-side navigation, or with `render="client"`) go through the same queue.

## Prefetching

An island that waits for a reader (`interaction`, `idle`, or `media`) doesn't download its data until then. Once the island comes within its `margin` of the viewport (320 pixels by default) and the browser is idle, the library fetches its part, the other parts it reads, and its code, all at low priority. Islands that wake on `visible` or `eager` skip this, since they download when they wake. Prefetching stops on slow connections and when someone has turned on data saving, and it's capped at 1 MiB per page. Set `prefetch={false}` to turn it off for one island.

## Code splitting and shell pages

With the [Vite plugin](../20-core-concepts/70-vite-plugin.md), the build moves each island's snippet into its own chunk, and the server records which chunk belongs to which island. A page that renders normally loads only the chunks of the islands it needs.

On a [shell page](../20-core-concepts/80-shell-pages.md), which is a page with `csr = false`, SvelteKit doesn't run its client, so something else has to boot the islands. The server writes the islands' data, their page values, and their chunk names into a JSON script, along with a small module that starts them. The module loads each island's chunk only when that island needs it.

## Fresh requests

A [fresh island](../20-core-concepts/90-fresh-islands.md) renders its fallback in the first response, so the page can be cached. When the page loads, the browser asks for its fresh islands at `/_parts/fresh`, using the page's address. The server renders that page again for this visitor, collects the fresh islands and their parts, and sends them back in one private response that shared caches never keep. The browser then draws each island from it. If the server can't render the page again, the islands keep the page's own values.

## Held input

Until an island is live, the library holds what the reader does in it, then replays it. A click on a button or another control that isn't a native form control is pressed again once the island hydrates. Links aren't held, since they navigate on their own. Native fields such as text inputs and checkboxes aren't intercepted, but the values someone typed or checked are kept when the island hydrates. A form submission is held and sent again with `requestSubmit`.

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
