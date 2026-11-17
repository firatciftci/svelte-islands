---
title: Setup
description: Install svelte-islands and let init set up a SvelteKit 3 app, or make the edits by hand: a transport, a server handle, a stylesheet, and the optional Vite plugin. Then make your first island.
---

svelte-islands needs SvelteKit 3 and Svelte 5.57 or later. Install it with your package manager of choice:

```sh
npm install svelte-islands
```

Then run `init`, which makes the edits below for you. It changes only what's missing, so it's safe to run again:

```sh
npx svelte-islands init
```

Each edit is below, for when you'd rather make them yourself or want to see what `init` did. Nothing on your pages changes until you make your first part.

## Register the transport

A part has to survive the trip from the server to the browser, which is what SvelteKit's [`transport` hook](https://svelte.dev/docs/kit/hooks#Universal-hooks-transport) is for:

```ts
/// file: src/hooks.ts
import { islands } from "svelte-islands";

export const transport = islands();
```

If you already have transport codecs, pass them in: `islands({ codecs })`. And if your app sets [`paths.base`](https://svelte.dev/docs/kit/configuration#paths), the URL prefix for parts has to include it: `islands({ prefix: "/docs/_parts/" })`.

## Add the handle

The handle serves parts, deferred HTML, and learned skeletons under `/_parts/`:

```ts
/// file: src/hooks.server.ts
import { handle as islands } from "svelte-islands/server";

export const handle = islands();
```

If you have other handles, put it early in your [`sequence`](https://svelte.dev/docs/kit/@sveltejs-kit-hooks#sequence), because a handle that answers before it would turn a request for a part into a page of HTML.

## Import the styles

Skeletons need a little CSS, so import it once in your root layout:

```svelte
<!--- file: src/routes/+layout.svelte --->
<script>
  import "svelte-islands/styles.css";

  let { children } = $props();
</script>

{@render children()}
```

## Add the Vite plugin

The Vite plugin is optional. It gives each island its own chunk of JavaScript, so a page downloads an island's code along with its data, and it's what makes islands work on pages with `csr = false`. Add it next to `sveltekit()`:

```ts
/// file: vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { islands } from "svelte-islands/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [sveltekit(), islands()] });
```

[The Vite plugin](../20-core-concepts/70-vite-plugin.md) describes what it changes in your build.

## Your first island

Pick the heaviest value on a page (a long list of products, for example), and wrap it in `part` in the server `load` function...

```ts
/// file: src/routes/products/+page.server.ts
import { part } from "svelte-islands/server";
import { getProducts } from "#lib/server/catalog.js";

export async function load() {
  return { products: part("catalog.products", await getProducts()) };
}
```

...then render it with `Island`, which passes the value to its snippet:

```svelte
<!--- file: src/routes/products/+page.svelte --->
<script>
  import { Island } from "svelte-islands";
  import ProductTable from "./ProductTable.svelte";

  let { data } = $props();
</script>

<Island part={data.products}>
  {#snippet children(products)}
    <ProductTable {products} />
  {/snippet}
</Island>
```

Now open the page with your browser's network panel showing. The table is in the HTML, but the products aren't in the page's data anymore. Move your pointer over the table and you'll see a request to `/_parts/`, followed by the table becoming interactive, because by default an island [wakes on the first interaction](../20-core-concepts/30-when-islands-wake.md).

There's also a request for `/_parts/skeletons.json` soon after the page loads. That's the [skeleton file](../20-core-concepts/40-skeletons.md), which holds placeholder shapes, not your data.

If you don't see a request, the value is probably small enough to [stay in the page](../20-core-concepts/10-parts.md#small-parts-stay-in-the-page).

`data.products` is a `Part` now, where it used to be an array, so `svelte-check` will flag anywhere else that read it. [Moving a page to islands](../70-appendix/10-migrating.md) walks through the ways to fix those.

Once the page is running, `npx svelte-islands inspect <url>` lists its islands, with where each one's HTML comes from and the size of its part. [Init and inspect](../50-tooling/05-init-and-inspect.md) covers both commands.

If you'd rather learn by building something, the [tutorial](30-tutorial.md) makes a product listing page one step at a time, and the [examples](../35-examples/10-comments.md) range from a comment thread to running at scale.
