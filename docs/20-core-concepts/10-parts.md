---
title: Parts
---

A _part_ is a value that travels outside the page's data. You make one in a server `load` function by giving a value a name:

```ts
/// file: src/routes/results/+page.server.ts
import { part } from "svelte-islands/server";

export async function load() {
  return { rows: part("results.rows", await get_rows()) };
}
```

`data.rows` is now a `Part` rather than an array, and that's the point — what reaches the browser in your page's data is a small object holding a name, a hash, and a size.

To get at the value itself you use an [`Island`](20-islands.md), or [`peek` or `load`](50-reading-parts.md) in a script.

## Content addressing

`part` serializes the value and hashes the result, and that hash becomes the part's URL (`/_parts/<hash>.json`).

This has a useful consequence: what's at that URL can never change, because different contents would have a different URL. So the server sends it with `cache-control: public, max-age=31536000, immutable`, and browsers and CDNs can keep it for good.

You will never have to bust a cache when your data changes, either. New data means a new hash, and a new hash means a new URL.

Only the contents count toward the hash, so the same value on two pages is one download, whatever name it goes by.

## Small parts stay in the page

A part of 4,096 characters or less stays in your page's data, because a separate request would cost more than it saves. You can change the limit with `islands({ inline })`.

This has a consequence you might not expect: an island around a small part is not a hydration boundary. The component hydrates along with the rest of the page, so `when` will not delay it.

If you want it to wait anyway, add [`defer`](20-islands.md#deferred).

## Names

The name is how the library recognizes _this kind of data_ from one page to the next. A skeleton learned for `results.rows` on one page is the one it shows on the next, so you should keep the name stable and leave out anything that varies:

```ts
// don't do this — every election gets a new name, so none of them reuse a skeleton
part(`results.${election.id}`, rows);

// do this
part("results.rows", rows);
```

The [`stable-part-name`](../50-tooling/20-eslint.md) ESLint rule catches the first one.

## When the browser downloads it

`part` takes an options object as its third argument. Its `fetch` option sets when the browser downloads the value:

```ts
/// file: src/routes/results/+page.server.ts
export async function load() {
  return {
    chart: part("results.chart", await get_chart(), { fetch: "preload" }),
  };
}
```

- `auto` (the default) waits until the island needs it on a first page load, and starts as soon as the page's data arrives when someone navigates from elsewhere in your app
- `lazy` only downloads when the island needs it or you call [`load(part)`](50-reading-parts.md)
- `preload` starts as soon as the page arrives, and on a first page load adds a `<link rel="preload">` to the page's head (as long as the part is ready before the server sends the head)

You should use `preload` for data your page needs right away that's too large to inline — the data behind a chart at the top of the page, for example. Use `lazy` for data that's expensive to download.

With `auto`, a link that uses [`data-sveltekit-preload-data="hover"`](https://svelte.dev/docs/kit/link-options#data-sveltekit-preload-data) can start the download as soon as someone hovers over it on SvelteKit 3.1 or later. On 3.0, the download starts when they click.

## What can go in a part

Anything you could return from a server `load` function, including your own [transport codecs](https://svelte.dev/docs/kit/hooks#Universal-hooks-transport).

You'll need to `await` it first, though, because `part` hashes the value as soon as you call it.

Plain data (objects, arrays, strings, numbers, booleans, `null`, and `undefined`) travels in a [compact packed form](../70-appendix/40-how-it-works.md#compact-transport). Dates, maps, and the like are sent in [devalue](https://github.com/sveltejs/devalue)'s format, as they would be in page data.

One thing that must _not_ go in an ordinary part is anything that differs per visitor. The URL is public, and anyone who has it can read what's there, so see [private data](../60-best-practices/10-private-data.md).

## When a part goes missing

A server can lose a part. It might have restarted, or a different server might have made the part in the first place.

This is not an error: the browser asks again with the page the part came from, and the server reruns that page to make it again. If the page no longer makes that part, because your data has changed, the browser reloads the page's data once.

That's cheap for one visitor and expensive for thousands, which is why rebuilds are [limited](../40-build-and-deploy/10-node-servers.md#rebuilds), and why you'll want a [store](../40-build-and-deploy/20-stores.md) if you run more than one process.

Any other failed download is retried after 1, 3, and 5 seconds before the island [gives up](20-islands.md#when-a-part-cant-be-loaded).
