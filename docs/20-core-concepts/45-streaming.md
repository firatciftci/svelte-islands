---
title: Streaming slow data
description: Show a SvelteKit page before its slow queries finish. stream() waits briefly for promises, and Await shows a skeleton until the rest arrives.
---

SvelteKit shows a page only once its `load` function returns. If `load` waits on a slow query (the reviews under a product, say), a reader who clicks a link sees the old page sit there, with no sign that anything is happening. A server `load` can return a promise instead, which SvelteKit streams to the browser. Use `stream()` to pick which values are worth waiting for, and [`Await`](40-skeletons.md#await) shows the rest with a learned skeleton until they arrive.

## `stream()`

`stream()` takes an object of values and promises, and waits a short time for them:

```ts
/// file: src/routes/products/[slug]/+page.server.ts
import { stream } from "svelte-islands/server";

export async function load({ params }) {
  const product = await getProduct(params.slug);
  return {
    product,
    ...(await stream({
      reviews: getReviews(params.slug),
      related: getRelated(params.slug),
    })),
  };
}
```

A value that settles within the budget (150 ms by default) comes back as the value itself, so a page whose data is already cached renders in full and streams nothing. A value that takes longer comes back as its promise, and SvelteKit streams it.

You can change the budget with `stream(values, { budget })`. `budget: Infinity` waits for everything, which is what you want for [crawlers](#crawlers-and-readers-without-javascript).

`stream()` takes an object and not a single promise, because an `async` function that returns a promise waits for it, so `load` could never hand one back.

## Showing it with `Await`

Pass each streamed value to an `Await`. A value that has already settled renders right away, on the server too. A promise shows its skeleton until it resolves:

```svelte
<Await
  promise={data.reviews}
  name="product.reviews"
  key={data.product.id}
  reserve="40rem"
>
  {#snippet children(reviews)}
    <Reviews {reviews} />
  {/snippet}
  {#snippet failed()}
    <p>The reviews didn't load.</p>
  {/snippet}
</Await>
```

`Await` doesn't use `{#await}`, and it behaves differently in three ways:

- A promise that resolves within 120 ms never shows its skeleton, so a quick navigation doesn't flash one. You can change the delay with `--island-delay`.
- If the new promise has the same `key` as the last one that resolved, the old content stays on screen until the new value arrives, with `aria-busy="true"` and a `data-island-stale` attribute you can style. With a different `key`, or none, the skeleton shows.
- If the URL's hash names an element inside the streamed content, `Await` scrolls to it once the content renders, unless the reader has scrolled in the meantime.

Use a `key` that names what the content is about, such as the product's id, and not something that changes with every filter or tab. Then sorting the reviews keeps them in place while the new order loads, and opening another product shows a skeleton:

```css
[data-island-stale] {
  opacity: 0.6;
  transition: opacity 0.2s 0.2s;
}
```

## Showing part of the page right away

Some of a streamed region can be known before the data arrives, such as a title from a value you already awaited. Pass a `pending` snippet to show it at once. The snippet receives the skeleton as its argument, and the skeleton keeps its 120 ms delay:

```svelte
<Await promise={data.reviews} name="product.reviews" key={data.product.id}>
  {#snippet children(reviews)}
    <header data-island-skip>
      <h2>Reviews of {data.product.name}</h2>
    </header>
    <Reviews {reviews} />
  {/snippet}
  {#snippet pending(skeleton)}
    <header>
      <h2>Reviews of {data.product.name}</h2>
    </header>
    {@render skeleton()}
  {/snippet}
</Await>
```

Since `pending` already draws the header, the skeleton shouldn't draw a second one. Add `data-island-skip` to an element, and the library leaves that element and everything inside it out of the skeleton that the library learns.

## Caching

A response that streamed has skeletons where its content should be, so a shared cache shouldn't keep it. When `stream()` hands back a promise, `handle()` sets `cache-control: private, no-cache` on the response, unless the response already has a `cache-control` header. A response whose values all settled within the budget is left alone, and you can cache it as usual.

To turn this off, pass `handle({ shareStreamed: true })`.

## Crawlers and readers without JavaScript

Svelte renders the server's HTML in order, so streamed content arrives in scripts at the end of the response and appears only once the page hydrates. A crawler that doesn't run JavaScript, or a reader who has turned it off, sees the skeleton.

If search engines need to see the content (and for product reviews they usually do), give known crawlers the whole page:

```ts
/// file: src/routes/products/[slug]/+page.server.ts
import { stream } from "svelte-islands/server";

export async function load({ params, request }) {
  const crawler = isCrawler(request.headers.get("user-agent"));
  return stream(
    { reviews: getReviews(params.slug) },
    { budget: crawler ? Infinity : 150 },
  );
}
```

## Limits

- On back and forward navigation, SvelteKit restores the scroll position before the streamed content arrives, so it lands on the skeleton's height. A learned skeleton is usually close to that height, and `reserve` holds the space on a first visit.
- `failed` receives the error, but it gives no way to retry. You can call [`invalidate`](https://svelte.dev/docs/kit/$app-navigation#invalidate) from it to run `load` again.
