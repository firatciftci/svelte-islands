---
title: Islands
description: An island is a region of a SvelteKit page that loads and hydrates on its own. Covers the server, deferred, client-only, and fresh render modes and how to choose one.
---

An _island_ is a region of your page that loads and hydrates on its own. `Island` takes a [part](10-parts.md) and passes its value to a snippet:

```svelte
<!--- file: src/routes/products/+page.svelte --->
<Island part={data.products}>
  {#snippet children(products)}
    <ProductTable {products} />
  {/snippet}
</Island>
```

The `render` prop decides where an island's HTML comes from, and there are four choices. They differ in what happens to that HTML, and you can see the first three in action here:

<!-- example: modes -->

## Static

By default (`render="server"`), the server renders the island's HTML into your page, and it stays there untouched until the island's [`hydrate` strategy](30-when-islands-wake.md) fires. The browser then downloads the part and hydrates the island, adopting the HTML that is already there.

We call this _static_ because, until then, it is: no code is running, and the data is not in memory.

This is the mode you should reach for first.

## Deferred

Some content is not worth putting in the page at all, at least until someone scrolls near it. With `render="deferred"`, the server renders the HTML but stores it under a hash of its contents instead of putting it in your page...

```svelte
<Island part={data.products} render="deferred">
  {#snippet children(products)}
    <ProductTable {products} />
  {/snippet}
</Island>
```

...and the page gets the island's [skeleton](40-skeletons.md) in its place.

When the island nears the viewport, the browser fetches the HTML from its immutable URL and swaps it in. That moment is set by `reveal`, which defaults to `"visible"`. The island then hydrates when `hydrate` fires, like any other, and that defaults to `"interaction"`. (If `hydrate` is `visible` or `eager`, the data comes down alongside the HTML.)

`reveal` takes a strategy, as `hydrate` does, for the times when nearing the viewport is not the moment you want. `reveal="idle"` fetches the HTML when the browser is idle. `reveal="eager"` fetches it while the page is still loading and swaps it in as soon as it arrives, often before your JavaScript has loaded, so that a long table near the top can stay out of the page without waiting for hydration.

This has a trade-off: content that is not in the page is not there for anyone without JavaScript. So you should use `render="deferred"` for long content below the fold (the reviews under a product, say), and not for the content someone came to your page to read.

If the HTML cannot be fetched, the island renders in the browser instead.

## Client-only

With `render="client"`, the server sends only the skeleton, and the island renders in the browser when `hydrate` fires. In this mode, `hydrate` defaults to `"visible"` rather than `"interaction"`:

```svelte
<Island part={data.stores} render="client" margin="600px">
  {#snippet children(stores)}
    <StoreMap {stores} />
  {/snippet}
</Island>
```

You can use this for a component that cannot render on the server (a map, usually), or whose server HTML is not worth sending.

The server still renders the island now and then to learn its skeleton. If that render throws, because your map library reached for `window`, the island falls back to a generic skeleton.

## Fresh

`render="fresh"` is for an island whose HTML depends on the visitor (a cart, say) on a page that the server can cache or prerender. The page holds the island's skeleton, which is the same for everyone. Once the island mounts, the browser fetches that visitor's HTML, and the island then hydrates as usual, using the value it was rendered from. The fresh islands on a page share one request.

[Fresh islands](90-fresh-islands.md) covers the setup, including `fresh()`, which makes the part that each visitor's HTML is rendered from.

## Choosing a mode

- if it's mostly read, with a few controls, use the default
- if it's a chart or map that should be live as soon as it's visible, use `hydrate="visible"`
- if it's long and below the fold, use `render="deferred"`, and add `hydrate="visible"` if it should be live as soon as it's visible
- if it can't render on the server, use `render="client"`
- if it differs per visitor on a page you cache, use `render="fresh"`
- if it never responds to anything, use `hydrate="never"`
- if it's a table too long to hydrate in one go, use [`as="tbody"`](../30-long-content/20-long-tables.md), which needs `render="server"`

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
<Island part={data.products}>
  {#snippet children(products)}
    <ProductTable {products} />
  {/snippet}

  {#snippet failed(retry)}
    <p>The products did not load. <button onclick={retry}>Try again</button></p>
  {/snippet}
</Island>
```

Without one, you get a plain Retry button.

A static island that can't load its data is different, because it still has its server HTML. It keeps showing that, so it stays readable, but its controls will not respond.
