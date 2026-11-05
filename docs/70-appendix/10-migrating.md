---
title: Moving a page to islands
---

You can move an existing page one value at a time. Your app keeps working after each step, so you can stop whenever you like and ship what you have.

## Measure the page

You'll want to know what moved, so start by writing down where your page stands. Add a budget file to your project...

```json
/// file: islands.budget.json
{
  "limits": { "raw": 400, "gzip": 60, "inline": 150 },
  "pages": { "/results": {} }
}
```

...and run [the check](../50-tooling/10-budget-check.md) against a running copy of your app:

```sh
npx svelte-islands check http://localhost:4173
```

## Add the library

Follow [setup](../10-getting-started/20-setup.md). It takes three small edits, and nothing changes on your page until you make a part.

## Find the heavy values

Look at what your `load` functions return for the page. One or two values usually account for most of the serialized data (a long list of rows, a set of map shapes, a chart's series), so start with the largest one.

## Wrap the value in `part`

Give the value a name. The skeleton is learned by the library under this name, so you should [keep it stable](../20-core-concepts/10-parts.md#names):

```ts
/// file: src/routes/results/+page.server.ts
import { part } from "svelte-islands/server";

export async function load() {
  return { rows: part("results.rows", await get_rows()) };
}
```

## Render it in an island

Replace the place that reads the value with an `Island`:

```svelte
<!--- file: src/routes/results/+page.svelte --->
<script>
  import { Island } from "svelte-islands";

  let { data } = $props();
</script>

<Island part={data.rows}>
  {#snippet children(rows)}
    <ResultsTable {rows} />
  {/snippet}
</Island>
```

`data.rows` is now a `Part` and not an array, so `svelte-check` will flag every other place that read it. You can fix each one in one of three ways:

- if another component needs the same rows, render it in the same island, or give it [its own island](../20-core-concepts/50-reading-parts.md#views) with the same part and a `view`
- if it needs a total or a count, compute that on the server and return it from `load` as its own small value
- if a script needs the value, use [`peek` or `load`](../20-core-concepts/50-reading-parts.md)

## Pick when it loads

The default suits most content, and [choosing a mode](../20-core-concepts/20-islands.md#choosing-a-mode) lists the others.

A value of 4,096 characters or less [stays in your page](../20-core-concepts/10-parts.md#small-parts-stay-in-the-page), so an island around it costs almost nothing. It also is not a hydration boundary unless you add `defer`, so a small part will not delay its hydration.

## Keep per-visitor data out of public URLs

Parts are served from public, immutable URLs, so anything that differs per visitor needs [`private: true`](../60-best-practices/10-private-data.md). You can turn on the [ESLint rules](../50-tooling/20-eslint.md) to catch this as you write:

```js
/// file: eslint.config.js
import islands from "svelte-islands/eslint";

export default [islands.configs.recommended];
```

## Share parts between servers

If you run more than one process, or your hosting restarts processes often, pass `handle` a [store](../40-build-and-deploy/20-stores.md). Without one, a process that does not have a part reruns the page that made it.

## Keep it from growing back

Add `svelte-islands check` to CI, and render the [overlay](../50-tooling/30-overlay.md) in development:

```svelte
<!--- file: src/routes/+layout.svelte --->
<script>
  import { dev } from "$app/env";
  import Devtools from "svelte-islands/devtools";
</script>

{#if dev}
  <Devtools />
{/if}
```

## What behaves differently

- an island's server HTML renders synchronously, so its children can't use `await` — load the data into the part instead ([more on async mode](50-async-mode.md))
- a deferred island's HTML is not in the page yet, so a link to an id inside it finds nothing unless that id is on a heading — put the id on an element outside the island
- an island's wrapper is a `div`, which the browser moves out of a table, so inside a table you should use [`as="tbody"`](../30-long-content/20-long-tables.md)
- a deferred island's content is not in the first response, so a test that looks for it in the page's HTML will have to use a browser
