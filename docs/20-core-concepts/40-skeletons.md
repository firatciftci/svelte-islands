---
title: Skeletons
---

A _skeleton_ is what an island shows while it waits for its content. You don't write them, because the library learns each one from what the island rendered:

```html
<!-- what the island rendered -->
<tr class="row">
  <td class="name">Harrow Sound</td>
  <td class="votes">12,408</td>
</tr>

<!-- what the skeleton keeps -->
<tr class="row">
  <td class="name"><span class="island-bone" style="--n:12"></span></td>
  <td class="votes"><span class="island-bone" style="--n:6"></span></td>
</tr>
```

Your classes stay, so the skeleton is laid out by the same CSS as the real thing. Text becomes a bar about as long as the text was, and images become blocks of the same shape.

## How they're learned

The server turns each island's rendered HTML into a skeleton, and the browser does the same from the live DOM, saving what it learns in `localStorage`.

A skeleton is kept per part name and [view](50-reading-parts.md#views), which is why you should [keep your names stable](10-parts.md#names). Rendering one instance teaches the library what the next one looks like.

A page's HTML holds only the skeletons it shows right away. The browser fetches the rest from `/_parts/skeletons.json` when it is idle, so that a client-side navigation can show them.

On the very first visit there's nothing to go on, so the island shows a plain placeholder. You can style that with [`--island-surface` and `--island-inset`](../60-best-practices/20-styling.md).

## Long content

Skeletons have to fit in your page, so each one stays under 12 KB. To do that, a skeleton keeps only the first few of a run of repeated elements, and it drops any content with no text or media.

This means a long list's skeleton is shorter than the list. If your island is below the fold that does not matter, because content that grows below the viewport does not move what someone is reading. If it's further up, the page can jump when the content arrives, and there's more on that in [troubleshooting](../70-appendix/20-troubleshooting.md#the-page-jumps-when-an-island-loads).

Table rows are the exception: the rows a skeleton leaves out become one spacer row that holds their height. By default that's `2em` per row, so you should set `--island-item` to the height of a row:

```svelte
<div style="--island-item: 2.75rem">
  <Island part={data.rows} defer when="visible">
    {#snippet children(rows)}
      <ResultsTable {rows} />
    {/snippet}
  </Island>
</div>
```

## `Await`

A region that is not an island can still have to wait for something, and it would be a shame to write a placeholder by hand. `Await` takes a promise (one streamed from `load`, for example) and a name, and passes the resolved value to its snippet:

```svelte
<Await promise={data.counties} name="election.counties" reserve="24rem">
  {#snippet children(counties)}
    <Counties {counties} />
  {/snippet}
</Await>
```

`name` is the name the skeleton is learned under. Part names and these names share one namespace, so an `Island` and an `Await` with the same name use the same skeleton.

`reserve` is a CSS block size to hold open before anything has been learned. You should set it close to the content's height, so that your page does not jump on a first visit.

The skeleton waits 120 ms before it shows, so data that arrives quickly never flashes one. If you pass a `key`, a new promise with the same `key` keeps the old content on screen until it resolves, instead of showing the skeleton. [Streaming slow data](45-streaming.md) covers both, and also shows the server side with `stream()`.

If the promise rejects, an optional `failed` snippet receives the error.

The server also renders `children` once the promise resolves, and learns from that HTML. So later visitors get a skeleton based on a server render that waited for the data.

## `Pending`

`Pending` does the same for a loading state you drive yourself, such as a query's `isPending`:

```svelte
<Pending name="figures" isPending={query.isPending} reserve="2rem">
  <Figures data={query.data} />
</Pending>
```

Neither component adds a box, so the content and its skeleton keep their places in a parent grid or flex layout.

## `learn`

If a `Pending` gets replaced by content it doesn't wrap (a map in another branch of an `{#if}`, say), you can attach `learn(name)` to the element that holds that content:

```svelte
{#if view == null}
  <Pending name="map" isPending={true} reserve="32rem" />
{:else}
  <div {@attach learn("map")}><Map {view} /></div>
{/if}
```

## What a skeleton gives away

Skeletons remove text, attribute values, images, and URLs, but they keep the class names and layout of what they were learned from.

If even that structure is sensitive, mark the [part as private](../60-best-practices/10-private-data.md), or use `<Await private>`, and no skeleton will be learned from it.
