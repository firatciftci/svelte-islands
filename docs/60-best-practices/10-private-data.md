---
title: Private data
description: Parts are served from public, cacheable URLs. Keep per-visitor data out of them with private parts, and see how the library catches mistakes.
---

Parts are fast because anyone can cache them. A part larger than 4,096 characters is stored under a hash of its contents and served from a public URL with `cache-control: public, immutable`, which means anyone with the URL can read it, and any CDN or proxy along the way can keep a copy.

So an ordinary part must _not_ hold anything that differs per visitor. If Alice's account page made one, its URL would serve Alice's account to anyone who had it, and a proxy could keep a copy long after Alice logged out.

Pass `private: true` for that data:

```ts
/// file: src/routes/account/+page.server.ts
import { part } from "svelte-islands/server";

export async function load({ cookies }) {
  return {
    account: part("account", await get_account(cookies), { private: true }),
  };
}
```

The library never stores a private part or gives it a URL. It stays in your page's data, and SvelteKit sends it to the browser the same way it sends the rest of your `load` data.

An island that reads a private part renders as a static island: its HTML is in the page, and it is not deferred to a public URL. The server does not learn a skeleton from it, so nothing about its shape reaches the shared skeleton file that every visitor gets.

A private part nested inside a public part throws an error, because the outer part would publish it.

## `Await`

For content that comes from an `<Await>` (not a part), set `<Await private>` so the server does not learn a skeleton from it. The visitor's browser still saves that skeleton for later navigations; see Skeletons below.

## Skeletons

Skeletons remove text, attribute values, images, and URLs, but they keep the class names and layout of what they were learned from. You should mark a part or `<Await>` as private if even that structure is sensitive.

Private content still teaches the visitor's _own_ browser, which saves the skeleton in `localStorage` so the same visitor sees it on a later client-side navigation. No other visitor receives it. On a shared computer, the next person to use the browser could find that shape in storage, along with anything else your site keeps there.

## Catching mistakes

In dev, the library warns when a public part is made during a request that has read cookies:

```
svelte-islands: part("account") was made during a request that read cookies. Parts are served from a public, immutable URL. If this value differs per visitor, pass { private: true }. If it doesn't, pass warnOnCookies: false to handle().
```

You can turn this off with `handle({ warnOnCookies: false })`, and the [`no-public-per-visitor-part`](../50-tooling/20-eslint.md) ESLint rule catches common cases as you write.

If a part with personal data has already gone out, add `private: true` and treat what went out as public.
