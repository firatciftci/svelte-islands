---
title: An account page
---

An account page mixes two kinds of data: some of it belongs to the one person looking at it, and some of it is the same for everyone. The two need different treatment, because a [part](../20-core-concepts/10-parts.md) is served from a public URL that any cache along the way can keep.

We'll build an online store's account page with three things on it:

- the visitor's order history, which is theirs alone
- a "Buy again" shelf drawn from the store's product catalog, which every visitor shares
- the visitor's loyalty points, which come from a slow service and stream in

## The load function

The catalog comes from a helper of its own, for reasons we'll get to in a moment:

```ts
/// file: src/lib/server/catalog.ts
import { part } from "svelte-islands/server";

export async function catalogPart() {
  return part("store.catalog", await getCatalog());
}
```

The page's `load` reads the session cookie, and everything it returns that depends on that cookie is either small, private, or streamed:

```ts
/// file: src/routes/account/+page.server.ts
import { part, stream } from "svelte-islands/server";
import { catalogPart } from "#lib/server/catalog.js";

export async function load({ cookies }) {
  const customer = await getCustomer(cookies.get("session"));
  const orders = await getOrders(customer.id);

  return {
    name: customer.name,
    orderCount: orders.length,
    orders: part("account.orders", orders, { private: true }),
    catalog: await catalogPart(),
    ...(await stream({ points: getPoints(customer.id) })),
  };
}
```

`name` and `orderCount` are tiny, so they are plain values. `orders` could run to thousands of rows (a regular customer's whole history, for example), but they are this visitor's rows, so the part is private. `catalog` is the heavy, shared value, and it is the one that actually leaves the page.

## The page

```svelte
<!--- file: src/routes/account/+page.svelte --->
<script>
  import { Await, Island, peek } from "svelte-islands";
  import BuyAgain from "./BuyAgain.svelte";
  import OrderList from "./OrderList.svelte";

  let { data } = $props();
</script>

<h1>Hello, {data.name}</h1>

<Await promise={data.points} name="account.points" private reserve="1.5rem">
  {#snippet children(points)}
    <p>You have {points} points to spend.</p>
  {/snippet}
</Await>

<section>
  <h2>Your orders ({data.orderCount})</h2>
  <Island part={data.orders}>
    {#snippet children(orders)}
      <OrderList {orders} />
    {/snippet}
  </Island>
</section>

<section>
  <h2>Buy again</h2>
  <Island part={data.catalog} when="visible">
    {#snippet children(catalog)}
      <BuyAgain {catalog} orders={peek(data.orders)?.value ?? []} />
    {/snippet}
  </Island>
</section>
```

## Order history

The library never stores a private part or gives it a URL. It stays in your page's data, and SvelteKit sends it to the browser along with the rest of your `load` data, the same as if you had not called `part` at all.

That has a consequence worth knowing about: like a [small part](../20-core-concepts/10-parts.md#small-parts-stay-in-the-page), a private part is not a hydration boundary. The orders island renders and hydrates with the rest of the page, so `when` will not delay it, and `defer` is ignored (deferred HTML lives at a public URL).

So why make it a part at all? Because the library can then keep track of it, which matters in the next section.

## Buy again

The shelf is an island around the shared catalog, and it reads the visitor's orders with [`peek`](../20-core-concepts/50-reading-parts.md#reading-another-part-inside-an-island) to decide what to suggest.

While the server renders an island, it records every part the island reads. Here it sees a private one, which means this island's HTML holds something personal, so it renders as a [static island](../20-core-concepts/20-islands.md#static) even if you add `defer`, and no outline or skeleton is learned from it on the server.

You might be tempted to read `data.orders` directly inside the snippet. That works, but the library cannot see a value it did not hand you, and a later `defer` would publish this visitor's orders at a public URL. Reading through `peek` is what keeps it safe.

The catalog itself waits until the shelf comes into view. Once it has downloaded, it is cached for good, and the next visitor's browser (or your CDN) may already have it.

## Keeping shared data shared

`catalogPart` lives in its own file so that it cannot reach the visitor. The [`no-public-per-visitor-part`](../50-tooling/20-eslint.md#no-public-per-visitor-part) rule warns about any public part made in a function that reads `cookies` or `locals`, so if you made the catalog part inline in this `load` it would flag it, correctly, as far as it can tell.

The helper also documents a rule: a shared part must not depend on `cookies` or `locals`. If the catalog showed member prices for the visitor's tier, say, its URL would serve those prices to anyone who had it, and a CDN could keep a copy. It would also break [rebuilds](../40-build-and-deploy/10-node-servers.md#rebuilds), since a rebuild carries only `accept-language` (and whatever [`prepare`](../40-build-and-deploy/10-node-servers.md#prepare) adds), so the server would make a different part from the one the page asked for.

If some of the catalog really does differ per visitor, split it: keep the shared part shared, and send the per-visitor prices as a small value or a private part.

## The warning in dev

In development, the library also warns at runtime when a public part is made during a request that has read cookies:

```
svelte-islands: part("store.catalog") was made during a request that read cookies. Parts are served from a public, immutable URL. If this value differs per visitor, pass { private: true }. If it doesn't, pass warnOnCookies: false to handle().
```

The account page triggers it, because the check works per request and cannot tell that `store.catalog` is the same for everyone. Once you have confirmed that every public part made on your cookie-reading pages is shared, you can turn the warning off and rely on the ESLint rule from then on:

```ts
/// file: src/hooks.server.ts
import { handle as islands } from "svelte-islands/server";

export const handle = islands({ warnOnCookies: false });
```

The warning only sees cookie reads that happen after the library's handle runs, which is one more reason to put it early in your `sequence`.

## Loyalty points

The points come from a slow service, so they're [streamed](../20-core-concepts/45-streaming.md) and shown with `Await`. Normally the server renders an `Await`'s children once the promise resolves and learns a skeleton from that render, which keeps the class names and layout (but none of the text).

`private` turns that off for one `Await`, so nothing about the points goes into the skeleton file that every visitor downloads. The visitor's own browser may still remember the shape in `localStorage`, and that never leaves their machine.

Since the server never learns a skeleton for it, `reserve` is what holds the space on a first visit, so you should set it close to the content's height.

## One part per visitor value

You might think about bundling the whole account into one part, with the orders nested inside. If the outer part is public, that throws:

```
svelte-islands: the private part "account.orders" is inside a public part, which would publish it. Make the outer part private too.
```

The outer part would carry the inner one's contents to a public URL, so the library refuses to make it. Keep per-visitor values as separate parts, or make the outer part private too.

## If personal data already went out

If a part with personal data has already been served publicly, adding `private: true` stops it from happening again, but it does not take back what went out. The old URL is immutable, which means every cache that saw it may keep it for up to a year.

To clean up as far as you can:

- add `private: true` and deploy, which also clears each process's memory
- delete the entry from your [store](../40-build-and-deploy/20-stores.md), which is named `p:` followed by the part's hash, after your store's prefix
- purge `/_parts/<hash>.json` from your CDN

The hash is in the request in your browser's network panel. Even after all of this, treat what went out as public, because a browser or proxy you do not control (a company's proxy, say) may still have it.

## Making it your own

- if a per-visitor value is small, return it as a plain value and skip `part`
- if an island reads per-visitor data, pass it through a private part and `peek`, so that the library knows
- if a value is the same for every visitor, make it in a function that never sees `cookies` or `locals`
- if a streamed value is personal, set `private` and `reserve` on its `Await`

[Private data](../60-best-practices/10-private-data.md) has the rules in short form.
