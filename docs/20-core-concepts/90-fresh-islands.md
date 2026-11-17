---
title: Fresh islands
description: render="fresh" keeps a cached page the same for every visitor, then fetches each island's HTML for the visitor after the page loads. Covers fresh(), the request the browser makes, and what happens without a server.
---

Some content depends on who's asking, such as a greeting or the contents of a cart, and the rest of the page doesn't. If you cache the page, you can't put that content in it. A fresh island solves this: the page is the same for everyone, and the island fetches its own HTML for each visitor after the page loads.

Make the island's part with `fresh()` from `svelte-islands/server`, and set `render="fresh"` on the island:

```ts
/// file: src/routes/+page.server.ts
import { fresh } from "svelte-islands/server";

export const load = async ({ cookies }) => ({
  visitor: await fresh(
    "visitor",
    () => ({ name: cookies.get("name") ?? "guest" }),
    { name: "guest" },
  ),
});
```

```svelte
<!--- file: src/routes/+page.svelte --->
<script>
  import { Island } from "svelte-islands";

  const { data } = $props();
</script>

<Island part={data.visitor} render="fresh">
  {#snippet children(visitor)}
    <p>Hello, {visitor.name}</p>
  {/snippet}
</Island>
```

`fresh(name, read, fallback)` takes a name, like `part()`, a `read` function that reads the visitor's value, and a `fallback` for everyone else. The render never calls `read`, so no visitor's data reaches the page's HTML.

## What happens on each visit

1. The server renders the page with the `fallback` in place of each fresh island's value, and leaves a skeleton where the island's content goes. The page's HTML is the same for every visitor, so you can cache it.
2. Once the islands mount in the browser, the browser asks for the page's fresh islands with one request. The request goes to your parts prefix plus `fresh` and carries the page's path and query in `u`: `/_parts/fresh?u=/products`. An island that mounts later, such as one inside an `{#if}` block, makes a request of its own.
3. The server renders the page again for that request, with the visitor's cookies. It returns only the fresh islands' HTML and their parts, with `cache-control: private, no-store`, so no cache keeps the response. Every part made during that render is private, as if you'd passed `private: true`.
4. The island puts the HTML in place, and it hydrates when its `hydrate` strategy fires, as any island does.

After a client-side navigation to the page, the island asks the same way for the new page.

Until the response arrives, the visitor sees the skeleton, and if the request fails, the island renders the fallback. So choose a fallback that's a sensible default, such as a guest greeting or an empty cart.

## What it costs the server

The fresh request renders the _whole_ page again, which means every `load` function on the page runs for every visitor, even though only the fresh islands' HTML goes back. Caching the page makes the first paint fast, because the cached HTML arrives without waiting for the server, but it doesn't take work off the server: a page with a fresh island still costs one full render per visit, the same as a page you don't cache at all.

So fresh islands suit pages whose `load` functions are cheap, or whose expensive reads are cached on the server (a product catalog read from a cache rather than the database, for example). If a page is expensive to render and only a small corner of it depends on the visitor, you can write an endpoint of your own that returns just that corner and read it with `fetch` from the island. It costs less, but you have to write it yourself.

## Keep each island to its own part

An island should read only the part it's given. Any other part it reads goes into the same response, so the response grows with every part an island touches.

## When there's no server

The request needs a server that can render the page again. A prerendered page can't be rendered again, so the request for it fails, and the endpoint answers `502 Bad Gateway`. The server logs one warning for each such page, and the island shows its fallback. A static host has no endpoint at all, so the browser's request gets a `404`, and the island shows its fallback in the same way.

Serve the page from a server, and cache the page itself, not the fresh content. Set the cache header in `load` with `setHeaders`:

```ts
/// file: src/routes/products/+page.server.ts
import { fresh } from "svelte-islands/server";

export const load = async ({ cookies, setHeaders }) => {
  setHeaders({ "cache-control": "public, max-age=60" });
  return {
    visitor: await fresh(
      "visitor",
      () => ({ name: cookies.get("name") ?? "guest" }),
      { name: "guest" },
    ),
  };
};
```

The page is the same for everyone, so a shared cache can keep it for a minute. The fresh request is never cached, whatever the page's header says.

Fresh islands work on [shell pages](80-shell-pages.md) too, with the same request.
