---
title: A product page with slow data
description: A worked example of a product page that shows the product right away, then streams in slow reviews and related products.
---

A product page usually has one fast query and a few slow ones. The product itself comes from your own database in a few milliseconds, but reviews and "related products" often come from other services, and a reader who clicks through from a listing shouldn't stare at the old page while those finish.

Here the slow parts stream with [`stream()`](../20-core-concepts/45-streaming.md) and show with [`Await`](../20-core-concepts/40-skeletons.md#await), so the page appears as soon as the product is ready. The same page keeps old reviews on screen while new ones load, draws a heading before the data arrives, retries a failed request, and looks after crawlers and caches.

## The load function

The product is awaited, because the page has nothing to show without it. Everything else goes through `stream()`:

```ts
/// file: src/routes/products/[slug]/+page.server.ts
import { stream } from "svelte-islands/server";

export async function load({ params, url, depends }) {
  depends("product:reviews");

  const product = await getProduct(params.slug);
  const sort = url.searchParams.get("sort") ?? "helpful";

  return {
    product,
    sort,
    ...(await stream({
      reviews: getReviews(product.id, sort),
      related: getRelated(product.id),
    })),
  };
}
```

`stream()` waits up to 150 ms. A value that settles within that comes back as the value itself, so when your review service is warm the page renders in full and streams nothing. A value that takes longer comes back as its promise, and SvelteKit streams it to the browser in the same response.

The `depends` call gives the page a name to [invalidate](https://svelte.dev/docs/kit/$app-navigation#invalidate), which we'll use for retrying.

## The page

```svelte
<!--- file: src/routes/products/[slug]/+page.svelte --->
<script>
  import { invalidate } from "$app/navigation";
  import { Await } from "svelte-islands";
  import Related from "./Related.svelte";
  import Reviews from "./Reviews.svelte";

  let { data } = $props();
</script>

<h1>{data.product.name}</h1>
<p class="price">{data.product.price}</p>

<nav aria-label="Sort reviews">
  <a
    href="?sort=helpful"
    aria-current={data.sort === "helpful" ? "page" : undefined}
  >
    Most helpful
  </a>
  <a
    href="?sort=newest"
    aria-current={data.sort === "newest" ? "page" : undefined}
  >
    Newest
  </a>
</nav>

<Await
  promise={data.reviews}
  name="product.reviews"
  key={data.product.id}
  reserve="40rem"
  class="reviews"
>
  {#snippet children(reviews)}
    <h2 data-island-skip>Reviews of {data.product.name}</h2>
    <Reviews {reviews} />
  {/snippet}
  {#snippet pending(skeleton)}
    <h2>Reviews of {data.product.name}</h2>
    {@render skeleton()}
  {/snippet}
  {#snippet failed()}
    <p>
      The reviews didn't load.
      <button onclick={() => invalidate("product:reviews")}>Try again</button>
    </p>
  {/snippet}
</Await>

<Await
  promise={data.related}
  name="product.related"
  key={data.product.id}
  reserve="18rem"
>
  {#snippet children(related)}
    <Related products={related} />
  {/snippet}
</Await>
```

## Skeletons for the slow parts

Each `Await` has a `name`, and the library learns a skeleton under it from what the region rendered. The server renders `children` once the promise resolves and learns from that HTML, so after the first visit every reader sees a skeleton shaped like real reviews.

Keep the names stable (`product.reviews`, not one name per product), since a skeleton learned for one product is the one the next product shows.

On a first visit there is nothing learned yet, and `reserve` holds the space instead. You should set it close to the content's height, so that the related products below don't jump when the reviews arrive.

## Showing the heading right away

The heading does not depend on the reviews, so there's no reason for it to wait. The `pending` snippet draws it at once, and passes the skeleton through with `{@render skeleton()}`.

Then the skeleton must not draw a second heading. `data-island-skip` on the heading inside `children` tells the library to leave that element (and everything in it) out of the skeleton it learns, so the pending state shows one heading and one skeleton.

## Sorting without a flash

The sort links change `?sort`, so SvelteKit reruns `load`, and the page gets a new `reviews` promise. Since its `key` is the same product id as last time, `Await` keeps the old reviews on screen until the new ones arrive, instead of showing the skeleton.

While they are stale, the wrapper has `aria-busy="true"` and a `data-island-stale` attribute, which you can style:

```css
.reviews[data-island-stale] {
  opacity: 0.6;
  transition: opacity 0.2s 0.2s;
}
```

The transition's delay means a quick response never dims the list at all.

Going to another product changes the `key`, so the skeleton shows (with the heading, from `pending`). That's the point of using the product id and not, say, the sort: the key names what the content is _about_.

## Tuning the delay

A skeleton waits 120 ms before it shows, so data that arrives quickly never flashes one. If your reviews usually take a little longer than that, you can raise the delay for this region alone:

```css
.reviews {
  --island-delay: 250ms;
}
```

The `class` on `Await` lands on its wrapper, which is where the custom property needs to be.

## Retrying

`failed` receives the error, but `Await` has no retry of its own. The button calls `invalidate("product:reviews")`, which reruns the page's `load` because of the `depends` call, and `Await` gets a fresh promise.

This reruns the whole `load`, product query included. If that query is expensive, cache it on the server, or move the reviews into a `load` of their own.

## Crawlers

Svelte renders the server's HTML in order, so streamed content arrives in scripts at the end of the response and only appears once the page hydrates. A crawler that doesn't run JavaScript sees the heading and the skeleton, and not the reviews.

If you want reviews indexed, give known crawlers the whole page by raising the budget:

```ts
/// file: src/routes/products/[slug]/+page.server.ts
import { stream } from "svelte-islands/server";

export async function load({ params, url, request, depends }) {
  depends("product:reviews");

  const product = await getProduct(params.slug);
  const sort = url.searchParams.get("sort") ?? "helpful";
  const crawler = isCrawler(request.headers.get("user-agent"));

  return {
    product,
    sort,
    ...(await stream(
      {
        reviews: getReviews(product.id, sort),
        related: getRelated(product.id),
      },
      { budget: crawler ? Infinity : 150 },
    )),
  };
}
```

`budget: Infinity` waits for everything, so the response holds the finished HTML. It is slower for that one request, and crawlers are usually patient.

## Caching

A response that streamed has skeletons where its content should be, so a shared cache shouldn't keep it. When `stream()` hands back a promise, the library's handle sets `cache-control: private, no-cache` on the response, as long as the response does not already have a `cache-control` header.

That last condition is the one to watch. If you cache product pages at your CDN with `setHeaders`, set the header only when nothing streamed, or the library will leave your header alone and the CDN will keep a page full of skeletons:

```ts
/// file: src/routes/products/[slug]/+page.server.ts
import { stream } from "svelte-islands/server";

export async function load({ params, setHeaders }) {
  const product = await getProduct(params.slug);
  const slow = await stream({
    reviews: getReviews(product.id, "helpful"),
    related: getRelated(product.id),
  });

  const hasStreamed = Object.values(slow).some(
    (value) => value instanceof Promise,
  );
  if (!hasStreamed) {
    setHeaders({ "cache-control": "public, max-age=60" });
  }

  return { product, ...slow };
}
```

A cached streamed response is not broken for readers with JavaScript, because the streamed values travel at the end of the same response. It is crawlers and readers without JavaScript who would get the skeletons. If that trade is fine for your site, `handle({ shareStreamed: true })` lets shared caches keep streamed responses.

## Back, forward, and anchors

- on back and forward navigation, SvelteKit restores the scroll position before the streamed content arrives, so it lands on the skeleton's height — a learned skeleton is usually close, and `reserve` covers the first visit
- if the URL's hash names an element inside the reviews, `Await` scrolls to it once they render, unless the reader has scrolled in the meantime
- `Await` keeps content for one `key` at a time, so going back to the previous product shows the skeleton again if its data takes longer than the budget

## Making it your own

- if a value is fast and essential, `await` it and leave it out of `stream()`
- if a region has a title or a summary you already know, draw it in `pending` and add `data-island-skip` to the same element in `children`
- if a region changes with a filter, a tab, or a sort, give its `Await` a `key` that names the record
- if you need the content indexed, raise the budget for crawlers
- if you cache pages at a CDN, only set `cache-control` when nothing streamed

[Streaming slow data](../20-core-concepts/45-streaming.md) covers each of these in short form.
