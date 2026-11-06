---
title: Setup
---

svelte-islands needs SvelteKit 3 and Svelte 5.57 or later. Install it with your package manager of choice:

```sh
npm install svelte-islands
```

There are three small edits to make, and nothing on your pages changes until you make your first part.

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

If you have other handles, put it early in your [`sequence`](https://svelte.dev/docs/kit/@sveltejs-kit-hooks#sequence) — a handle that answers before it would turn a request for a part into a page of HTML.

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

## Your first island

Pick the heaviest value on a page, and wrap it in `part` in the server `load` function...

```ts
/// file: src/routes/results/+page.server.ts
import { part } from "svelte-islands/server";
import { get_rows } from "#lib/server/results.js";

export async function load() {
  return { rows: part("results.rows", await get_rows()) };
}
```

...then render it with `Island`, which passes the value to its snippet:

```svelte
<!--- file: src/routes/results/+page.svelte --->
<script>
  import { Island } from "svelte-islands";
  import ResultsTable from "./ResultsTable.svelte";

  let { data } = $props();
</script>

<Island part={data.rows}>
  {#snippet children(rows)}
    <ResultsTable {rows} />
  {/snippet}
</Island>
```

Now open the page with your browser's network panel showing. The table is in the HTML, but the rows aren't in the page's data any more. Move your pointer over the table and you'll see a request to `/_parts/`, followed by the table becoming interactive, because by default an island [wakes on the first interaction](../20-core-concepts/30-when-islands-wake.md).

There's also a request for `/_parts/skeletons.json` soon after the page loads — that's the [skeleton file](../20-core-concepts/40-skeletons.md), which holds placeholder shapes, not your data.

If you don't see a request, the value is probably small enough to [stay in the page](../20-core-concepts/10-parts.md#small-parts-stay-in-the-page).

`data.rows` is a `Part` now, where it used to be an array, so `svelte-check` will flag anywhere else that read it. [Moving a page to islands](../70-appendix/10-migrating.md) walks through the ways to fix those.
