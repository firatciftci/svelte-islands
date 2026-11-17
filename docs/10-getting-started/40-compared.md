---
title: Compared with ogygia and Mochi
description: How svelte-islands differs from ogygia and Mochi, why it fits most SvelteKit apps, and when one of the others is the better choice.
---

Two other projects bring islands to Svelte 5, and each makes a different bet about how much of SvelteKit to keep. [ogygia](https://www.ogygiajs.dev/) switches SvelteKit's client off for a route and adds interactive components back one at a time. [Mochi](https://mochi.fast/) leaves SvelteKit for a framework of its own on Bun. svelte-islands keeps your whole SvelteKit app and lets regions of a page wait for their data and their hydration.

If you build with SvelteKit, the third bet is usually the right one, for three reasons: an island stays part of your component, your app stays a SvelteKit app, and an island's data gets a URL of its own. Some cases fit one of the others better, and they're [at the end](#when-to-choose-ogygia).

> [!NOTE]
> This describes ogygia 0.13 and Mochi 0.9 as of November 2026, from their own documentation. All three projects are before 1.0 and change quickly.

## At a glance

|                              | svelte-islands                             | ogygia                                     | Mochi                     |
| ---------------------------- | ------------------------------------------ | ------------------------------------------ | ------------------------- |
| What it is                   | a library for SvelteKit                    | a library and Vite plugin for SvelteKit    | its own framework, on Bun |
| The rest of the page         | hydrates as usual                          | stays HTML, on routes with `csr = false`   | stays HTML                |
| Navigation                   | SvelteKit's                                | ogygia's router                            | full page loads           |
| What crosses into an island  | snippets, context, and live page state     | serialized props                           | serialized props          |
| Where an island's data lives | its own cacheable URL                      | the island's props                         | the island's props        |
| Getting started              | one command, or two hooks and a stylesheet | a Vite plugin, a handle, and `csr = false` | a new app                 |
| Runs on                      | any SvelteKit adapter                      | SvelteKit                                  | Bun only                  |

## The same island in each

The example below is a table of orders that hydrates when it scrolls into view. With svelte-islands, `load` wraps the orders in a [part](../20-core-concepts/10-parts.md), and the page renders it in an `Island`:

```svelte
<!--- file: src/routes/orders/+page.svelte --->
<script>
  import { Island } from "svelte-islands";
  import OrderTable from "./OrderTable.svelte";

  let { data } = $props();
</script>

<Island part={data.orders} hydrate="visible">
  {#snippet children(orders)}
    <OrderTable {orders} />
  {/snippet}
</Island>
```

With ogygia, the route sets `csr = false`, and the import says when the component wakes:

```html
<!--- file: src/routes/orders/+page.svelte --->
<script>
  import OrderTable from "./OrderTable.svelte" with { wake: "visible" };

  let { data } = $props();
</script>

<OrderTable orders="{data.orders}" />
```

With Mochi, a directive on the component does it:

```html
<OrderTable mochi:hydrate:visible {orders} />
```

They look alike, but what's allowed inside each boundary differs.

## An island is part of your component

In svelte-islands, an island's content is a snippet, written in the page like any other markup. It closes over the page's state, calls the page's functions, and hydrates with the [context](https://svelte.dev/docs/svelte/context) of the component around it. On a [shell page](../20-core-concepts/80-shell-pages.md), an island finds a context only by its name, so make it with `context()` from svelte-islands. Here a checkbox inside the island updates a count outside it:

```svelte
<script>
  import { SvelteSet } from "svelte/reactivity";
  import { Island } from "svelte-islands";

  let { data } = $props();

  const selected = new SvelteSet();

  function toggle(id) {
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
  }
</script>

<p>{selected.size} selected</p>

<Island part={data.orders}>
  {#snippet children(orders)}
    {#each orders as order (order.id)}
      <label>
        <input type="checkbox" onchange={() => toggle(order.id)} />
        {order.customer}
      </label>
    {/each}
  {/snippet}
</Island>
```

The [sortable table example](../35-examples/30-sortable-table.md) does this across three islands at once, with one selection shared by all of them.

In ogygia and Mochi, an island is its own component, hydrated on its own from props. Both serialize those props with devalue, so functions, snippets, and children stay behind ([ogygia](https://www.ogygiajs.dev/docs/reference/constraints) allows a fallback snippet on server islands, and [Mochi](https://mochi.fast/docs/selective-hydration/) allows children as the fallback on deferred and client-only islands). A value the page reads into an ogygia island is a serialized snapshot, so changing it updates nothing, and a store read the same way is "a snapshot frozen at render time". ogygia offers wired classes for state that several islands share.

That means you decide where each boundary goes before you build, and ogygia calls moving one later "the expensive path". With svelte-islands, a boundary is a wrapper you can move around a region, and the code inside it doesn't change.

## Your app stays a SvelteKit app

Setting up svelte-islands takes a transport hook, a server handle, and a stylesheet, or one `init` command that adds them. The Vite plugin is optional, and nothing else about your app changes: routing, `load`, form actions, client-side navigation, prerendering, and your adapter all work as before. You can wrap one region on one page, measure it, and stop there.

ogygia sits on SvelteKit too. Its model is a route that sets `csr = false`, and on those routes SvelteKit's client doesn't load. The page's own script never runs in the browser, so a top-level `onMount` or effect does nothing, anything interactive has to live in an island, and navigation goes through ogygia's router.

svelte-islands can also run on a `csr = false` route, with the Vite plugin, through [shell pages](../20-core-concepts/80-shell-pages.md).

Mochi replaces SvelteKit. Routes become `Mochi.page()` and its siblings, and by [Mochi's own comparison](https://mochi.fast/docs/mochi-vs-sveltekit/) it runs only on Bun, renders only on the server (there's no static build), and has no client-side router or remote functions.

## An island's data gets its own URL

An island's data in svelte-islands is a [part](../20-core-concepts/10-parts.md): a value stored at a URL named by a hash of its contents, and served with `cache-control: public, immutable`. Serialized props can't give you what follows from that:

- the page's HTML doesn't carry the data a second time, so a long table is in the page once, as HTML
- an island that never wakes never downloads its data
- two islands that read the same part share one download, and so does the next page that reads it
- a browser or CDN can keep a part forever, since its URL changes when its contents do
- a value of 4,096 characters or less stays in the page, so small islands cost nothing extra
- a [private part](../60-best-practices/10-private-data.md) stays in the page's data and never gets a URL

In ogygia and Mochi, an island's data is its props, serialized for that instance.

On the [benchmark](../70-appendix/60-benchmark.md) page, moving two tables and a chart into islands cut the HTML from 99 KB to 5 KB, and blocking time from 214 ms to 0. That compares against plain SvelteKit, not against the other two.

## What comes with it

These are the parts of the library that SvelteKit apps tend to need after their first island:

- a [skeleton](../20-core-concepts/40-skeletons.md) for each island, learned from what it rendered, so you rarely write a placeholder
- [clicks, form submissions, and typed text](../20-core-concepts/60-clicks.md) before hydration, held and replayed, so an early action of any of those kinds isn't lost
- [`render="deferred"`](../20-core-concepts/20-islands.md#deferred), which keeps an island's HTML out of the page until someone scrolls toward it
- [fresh islands](../20-core-concepts/90-fresh-islands.md), which render for each visitor on a page that can still be cached
- the [Vite plugin](../20-core-concepts/70-vite-plugin.md), which gives each island its own chunk of code, so the browser downloads it with the island's data
- [`unroll`](../30-long-content/10-long-lists.md), which renders a long list a few rows at a time without breaking find in page or printing
- [`Await` and `stream()`](../20-core-concepts/45-streaming.md), for data that arrives late
- a [budget check](../50-tooling/10-budget-check.md) for CI, an [overlay](../50-tooling/30-overlay.md), and an [ESLint rule](../50-tooling/20-eslint.md) that catches per-visitor data in a public part

## The trade-off

Keeping SvelteKit's client has a cost. A normal page with svelte-islands still loads SvelteKit's runtime and hydrates everything outside its islands, and the library adds about 11 KB of compressed JavaScript. An ogygia page with `csr = false` ships only its islands and a runtime that ogygia puts at about 7.6 KB.

You can close some of that gap by wrapping static regions in islands with `hydrate="never"`, which skip hydration and keep their data out of the page (these docs do this with every page's text). Without the Vite plugin, their code still ships with the page. With it, that code is in its own chunk, which the browser never downloads.

## When to choose ogygia

- if most of your routes are content with little to interact with (a blog or a docs site), and those routes can do without SvelteKit's client, `csr = false` plus a few islands ships the least JavaScript
- if you want content collections, a docs shell, and versioned or translated sites built in
- if you want the server to push re-rendered HTML into the page with `query.live`

## When to choose Mochi

- if you deploy to Bun and want queues, WebSockets, scheduled jobs, email, and SQLite in the same framework as your pages
- if your app is server-rendered pages that need neither client-side navigation nor a static build
- if you're happy to run alpha software and help shape it

## Choosing

For everyone else building with SvelteKit (an existing app, or a new one you expect to grow), svelte-islands lets you add islands where they pay off without changing how the rest of the app works. Start with [setup](20-setup.md), or follow the [tutorial](30-tutorial.md) to move a heavy page over one step at a time.
