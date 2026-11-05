---
title: Prerendering
---

Prerendered pages need no extra setup. When SvelteKit prerenders a page, the library writes the page's parts, its deferred HTML, and the skeleton file into the build under `_parts/`:

```ts
/// file: src/routes/results/+page.server.ts
import { part } from "svelte-islands/server";

export const prerender = true;

export async function load() {
  return { rows: part("results.rows", await get_rows()) };
}
```

`adapter-static` and other static hosts serve those files like any others. (These docs are built this way, if you want to see it working.)

You still need the [handle](../10-getting-started/20-setup.md#add-the-handle), since it runs during the build.

If your app sets `paths.base`, the prefix has to include it:

```ts
/// file: src/hooks.ts
import { islands } from "svelte-islands";

export const transport = islands({ prefix: "/docs/_parts/" });
```

A static host has no server to [rebuild](10-node-servers.md#rebuilds) a missing part, which leads to two differences.

## Old pages after a deploy

A visitor who still has an old page open can only load its parts if the host still has the old files.

If that matters to you, you should keep the previous build's `_parts/` files in place for a while. Their names are hashes of their contents, so old and new files never collide.

## The skeleton file

The skeleton file holds the shapes learned up to the moment the crawler requested it.

A page that was crawled later still has its own skeletons in its HTML, but a client-side navigation to that page can show a plain placeholder instead of a learned skeleton.
