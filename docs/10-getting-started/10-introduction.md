---
title: Introduction
---

## Before we begin

> [!NOTE]
> svelte-islands is new and has not reached 1.0, so you should expect the odd breaking change until it does. It was built for [electionsarchive.com](https://electionsarchive.com), where a single page can hold tens of thousands of rows.

If you're new to SvelteKit, we recommend starting with [its docs](https://svelte.dev/docs/kit). Everything here assumes you've written a `load` function and a component or two.

## What is svelte-islands?

svelte-islands is a library for SvelteKit pages that carry a lot of data. It keeps a big table, map, or chart out of the page's serialized data, and the browser only downloads that data when the part of the page that needs it wakes up:

```svelte
<!--- file: src/routes/results/+page.svelte --->
<script>
  import { Island } from "svelte-islands";

  let { data } = $props();
</script>

<Island part={data.rows} when="visible">
  {#snippet children(rows)}
    <ResultsTable {rows} />
  {/snippet}
</Island>
```

The table still renders on the server, so its HTML is in the page from the start.

But the browser will not download `data.rows`, or hydrate the table, until the table comes into view. Before that it's just HTML — nothing runs, and there is nothing to parse.

If you've used Astro, `when` will look familiar, since it does the job of a `client:*` directive.

## Why you might want it

A SvelteKit page sends your `load` data twice: once as HTML, and once as serialized data so that the page can hydrate.

For most pages that's fine, and you can stop reading here. For a page with a long table, the serialized copy can run to several megabytes, and the browser has to parse all of it before anything responds to a click.

svelte-islands takes that copy out of the page. Each value (we call it a [_part_](../20-core-concepts/10-parts.md)) is stored under a hash of its contents at its own URL, which means browsers and CDNs can keep it forever.

[Deferred islands](../20-core-concepts/20-islands.md#deferred) do the same for HTML, so a long table below the fold costs your page a small skeleton instead of hundreds of kilobytes of markup.

While a part's data is on its way, the island shows a [skeleton](../20-core-concepts/40-skeletons.md). You do not write these by hand — the library learns them from what the island rendered last time.

## What it won't do

Islands make the work happen later, and often never. They do not make it smaller.

A component with 10,000 elements takes just as long to hydrate when someone finally clicks on it, which is why there are separate tools for [long lists](../30-long-content/10-long-lists.md) and [long tables](../30-long-content/20-long-tables.md).

It also will not help a page that is already small. A part of 4,096 characters or less stays in the page, because a separate request would cost more than it saves.

[The benchmark](../70-appendix/60-benchmark.md) shows what you can expect, including where it makes little difference.
