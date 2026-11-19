---
title: Troubleshooting
description: Fixes for common svelte-islands problems: islands that stay static, part requests that return 404 or 503, layout jumps, and hydration mismatches.
---

If you can, render the [overlay](../50-tooling/30-overlay.md) first. It lists every island on the page with its state, data size, and timings, and it flags failed downloads and skeletons that were off by more than 16 pixels.

## An island stays static and its controls don't respond

The island's data probably failed to load. Look in the console for an `islands_part_failed` warning followed by the error, and look at the request to `/_parts/<hash>.json` in the network panel:

- if the response looks like binary garbage and its `content-encoding` is `br`, something compressed it twice — your proxy or CDN may be compressing a response the library had already compressed, so pass `handle({ compress: false })`
- if the request goes to the wrong path, your app probably sets `paths.base`, and the prefix has to include it: `islands({ prefix: "/docs/_parts/" })`
- if the response is a page of HTML, another handle answered first, so put the library's handle earlier in your `sequence`
- if the value can't be decoded, register your own types by passing `codecs` to `islands()`

## The Vite plugin leaves an island in the page

The plugin moves an island's code into its own chunk only when it can make a copy of the island's snippet and the values the snippet reads. When it can't, the island stays in the page and the build warns with a line like this:

```
islands_island_kept
src/routes/products/+page.svelte:12: the island stays in the page, because "label" means something else where the island is
https://firatciftci.github.io/svelte-islands/docs/appendix/errors#islands_island_kept
```

The reasons are:

- the island's children aren't a snippet the plugin can find, so declare the snippet in the same component
- the snippet reads `$$props`, `$$restProps`, or `$$slots`, or it uses `let:`, `<slot>`, or `<svelte:self>`
- an element in the snippet could match a selector in the page's scoped styles, so move the markup into a component or make the selector `:global` (see [scoped styles](../20-core-concepts/70-vite-plugin.md#when-a-snippet-stays-in-the-page))
- a name in the snippet means something else where the island is, or the same name means two different things

The island still works, but its code stays in the page's JavaScript instead of its own chunk. On a page with `csr = false`, it stays as server HTML.

## A page with csr = false throws about a page value

On a page with `csr = false`, an island gets a copy of each page value it reads, and the copy has to survive serialization. In development, an island that reads a function, or a value that can't be serialized, throws an error like this:

```
islands_shell_value
The island for part("products") reads `formatPrice` from the page, and it holds a function. On a page with csr = false, an island gets a copy of each page value it reads, so `formatPrice` can't reach it. Define it in a module the island imports, or move it inside the island's snippet.
https://firatciftci.github.io/svelte-islands/docs/appendix/errors#islands_shell_value
```

Define the function in a module that the island imports, or move it inside the island's snippet. In production, the library logs the same message and leaves that island as server HTML. Contexts have a similar limit on these pages: an island gets a context only if its key is a string or a `Symbol.for()` key, and its value can be serialized. Use `context()` from `svelte-islands` to make a key that reaches the island.

## The build warns that islands stay as server HTML

Pages with `csr = false` need the build to split code, so the plugin can boot their islands there. If the build has code splitting turned off, the plugin warns:

```
islands_no_code_splitting
The build doesn't split code, so each island's code stays in the main bundle, and islands on pages with csr = false stay as server HTML. Use the default output.bundleStrategy, "split".
https://firatciftci.github.io/svelte-islands/docs/appendix/errors#islands_no_code_splitting
```

Remove the output setting that turned splitting off, so that the build uses the default.

## Fresh islands show the page's own values

A `render="fresh"` island asks the server to render its page again for the visitor. On a prerendered page, the server can't do that, so the request fails. If you run a server, it logs:

```
islands_fresh_failed
The server couldn't render /products/shirt for its fresh islands, so they show the page's own values. The server can't render a prerendered page again, so render the page on the server and cache it with cache-control instead.
https://firatciftci.github.io/svelte-islands/docs/appendix/errors#islands_fresh_failed
```

The island shows the value the page was built with, which is the fallback. That's expected on a prerendered page or a static host. To get per-visitor values, render the page on the server, and cache it with a `cache-control` header instead. [Fresh islands](../20-core-concepts/90-fresh-islands.md) explains the request.

## Requests for parts return 404

One 404 is normal. When a server does not have a part (usually because it restarted, or because another server made the part), the browser asks again with the page the part came from, and the server reruns that page to make it again.

If the second request also returns 404, the page no longer makes that part, because its data changed. The browser then reloads the page's data once. You'll see this right after publishing new data, and it recovers on its own.

To avoid the rerun altogether, pass `handle` a [store](../40-build-and-deploy/20-stores.md).

## Requests for parts return 503

The rebuild queue is full, and the browser will retry. This means a lot of visitors are asking for parts the server does not have, which often follows a deploy.

A shared [store](../40-build-and-deploy/20-stores.md) fixes the cause. You can also raise the limits:

```ts
/// file: src/hooks.server.ts
export const handle = islands({ rebuild: { concurrency: 8, queue: 64 } });
```

## The page jumps when an island loads

The skeleton was a different height from the content. A skeleton keeps only the first few of a run of repeated elements, so a long list's skeleton is shorter than the list. There are a few ways to deal with this:

- for a table, set `--island-item` on a wrapper around the island to the height of a row
- put the island below the fold — the browser fetches it 320 pixels before it comes into view by default, and content that grows below the viewport does not move what someone is reading
- give a wrapper around the island a `min-block-size` close to the content's height
- on `Await` and `Pending`, set `reserve`

The `reveal` event from [`observe`](../50-tooling/40-measuring.md) reports the height before and after, so you can measure this for real visitors.

## Svelte warns about a hydration mismatch

The island rendered differently in the browser than on the server, so Svelte replaced that block. An island has the same causes as any other SvelteKit component: dates, random values, and anything that depends on the locale or time zone.

The library records the other parts an island reads and loads them first, so a part read inside an island is not usually the cause.

## An island shows a skeleton instead of its server HTML

An island's children used `await`. The server renders an island's HTML synchronously, so it can't wait, and in dev the library logs a warning naming the part.

You should [load the data into the part](50-async-mode.md) instead.

## Table rows end up outside the table

An island's wrapper is a `div`, and the HTML parser moves a `div` out of a `table`.

Pass [`as="tbody"`](../30-long-content/20-long-tables.md#near-the-top), which needs server HTML in the page. Combining it with `render="deferred"`, `render="client"`, or `render="fresh"` throws an error while the page renders on the server:

```
The island "products" uses as="tbody", which needs its rows in the page. Use render="server".
```

## A link to an anchor doesn't land

The id is inside a deferred or client-only island, and that island's HTML is not in the page yet.

The [outline](../20-core-concepts/20-islands.md#screen-readers) keeps only headings that have ids, inside the named regions that hold them, so you should put any other id on an element outside the island.

If the id is inside an `Await`, its content had not arrived when the browser looked for the id. `Await` scrolls to the hash once the content renders, unless the reader has already scrolled. On back and forward navigation, SvelteKit restores the scroll position before streamed content arrives, so you should keep the skeleton's height close to the content's height with `reserve`.

## Printing or find in page misses content

Each island brings its content in when the browser is about to print, or when someone presses Ctrl+F or Cmd+F. There are two cases it can't cover:

- choosing Find from the browser's menu sends the page no event, so the library can't react to it
- a client-only island prints only if its code has already loaded, and find in page can't load one with no headings in its outline

There's more on this in [Printing and find in page](../30-long-content/30-printing-and-find.md).

## A part with personal data got a public URL

A part without `private: true` is stored under a public, immutable URL, and caches along the way can keep a copy. Add `private: true`, and treat anything that already went out as public.

The library has a [warning and an ESLint rule](../60-best-practices/10-private-data.md#catching-mistakes) that catch this in development.

## The service worker serves an old copy

`serveParts` serves parts from its cache first, because their names are hashes of their contents, so an old copy can't be wrong. Only the skeleton file comes from the network first.

If your app sets `paths.base`, [pass the same prefix](../40-build-and-deploy/60-service-workers.md#options).

## An error on Cloudflare Workers

The usual ones are [listed with the Workers setup](../40-build-and-deploy/40-cloudflare-workers.md#if-something-goes-wrong).
