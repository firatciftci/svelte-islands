---
title: Islands
---

An _island_ is a region of your page that loads and hydrates on its own. `Island` takes a [part](10-parts.md) and passes its value to a snippet:

```svelte
<!--- file: src/routes/results/+page.svelte --->
<Island part={data.rows}>
  {#snippet children(rows)}
    <ResultsTable {rows} />
  {/snippet}
</Island>
```

On a first page load, an island renders in one of three ways. The difference is what happens to its HTML, and you can see all three in action here:

<!-- example: modes -->

## Static

By default, the server renders the island's HTML into your page, and it stays there untouched until the island's [`when` strategy](30-when-islands-wake.md) fires. The browser then downloads the part and hydrates the island, adopting the HTML that is already there.

We call this _static_ because, until then, it is — no code is running, and the data is not in memory.

This is the mode you should reach for first.

## Deferred

Some content is not worth putting in the page at all, at least until someone scrolls near it. If you add `defer`, the server renders the HTML but stores it under a hash of its contents instead of putting it in your page...

```svelte
<Island part={data.rows} defer>
  {#snippet children(rows)}
    <ResultsTable {rows} />
  {/snippet}
</Island>
```

...and the page gets the island's [skeleton](40-skeletons.md) in its place.

When the island nears the viewport, the browser fetches the HTML from its immutable URL and swaps it in. The island then hydrates when `when` fires, like any other. (If `when` is `visible` or `eager`, the data comes down alongside the HTML.)

`defer` takes a strategy too, in case near the viewport is not the moment you want: `defer="idle"` fetches the HTML when the browser is idle.

This has a trade-off: content that is not in the page is not there for anyone without JavaScript. So you should use `defer` for long content below the fold, and not for the content someone came to your page to read.

If the HTML cannot be fetched, the island renders in the browser instead.

## Client-only

With `ssr={false}`, the server sends only the skeleton, and the island renders in the browser when `when` fires — which in this mode defaults to `visible` rather than `interaction`:

```svelte
<Island part={data.shapes} ssr={false} margin="600px">
  {#snippet children(shapes)}
    <Map {shapes} />
  {/snippet}
</Island>
```

You can use this for a component that cannot render on the server (a map, usually), or whose server HTML is not worth sending.

The server still renders the island now and then to learn its skeleton. If that render throws, because your map library reached for `window`, the island falls back to a generic skeleton.

## Choosing a mode

- if it's mostly read, with a few controls, use the default
- if it's a chart or map that should be live as soon as it's visible, use `when="visible"`
- if it's long and below the fold, use `defer when="visible"`
- if it can't render on the server, use `ssr={false}`
- if it never responds to anything, use `when="never"`
- if it's a table too long to hydrate in one go, use [`as="tbody"`](../30-long-content/20-long-tables.md)

## After a client-side navigation

All of this describes a first page load. When someone navigates to your page from elsewhere in your app, there is no server HTML to adopt, so the island shows its skeleton until the data arrives and then renders in the browser.

## Screen readers

Screen readers can reach an island before it loads. A deferred or client-only island puts a visually hidden _outline_ in your page, built from the server's rendering: its headings with their ids, inside the named regions that hold them.

The real content replaces the outline when it arrives.

The server caches each outline by part, view, and [`vary`](../40-build-and-deploy/10-node-servers.md#vary) value, so a client-only island does not render on every request. If a view renders three times with no headings (as a map would), the server stops rendering it as an outline for ten minutes.

Since only headings with ids survive in the outline, a link to any other id inside a deferred island finds nothing. You should put that id on an element outside the island.

## When a part can't be loaded

After its [retries](10-parts.md#when-a-part-goes-missing) run out, an island that was waiting for its data shows the `failed` snippet, which receives a function that tries again:

```svelte
<Island part={data.rows}>
  {#snippet children(rows)}
    <ResultsTable {rows} />
  {/snippet}

  {#snippet failed(retry)}
    <p>The results did not load. <button onclick={retry}>Try again</button></p>
  {/snippet}
</Island>
```

Without one, you get a plain Retry button.

A static island that can't load its data is different, because it still has its server HTML. It keeps showing that, so it stays readable, but its controls will not respond.
