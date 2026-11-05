---
title: Frequently asked questions
---

## When shouldn't I use this?

When your page is small. A part of 4,096 characters or less stays in the page anyway, so there is nothing to take out.

The other case is a page where most of what's on it has to be live as soon as it loads. Islands make work happen later, and if that work has to happen right away you'd only be moving it around.

## Does it need a server?

No. [Prerendered pages](../40-build-and-deploy/30-prerendering.md) work on any static host, and these docs are an example. A server adds [rebuilds](../40-build-and-deploy/10-node-servers.md#rebuilds), which a static host can't do.

## Can I use it without SvelteKit?

No. It relies on SvelteKit's `load` functions, transport hooks, and request handling.

## Which versions does it support?

SvelteKit 3 and Svelte 5.57 or later.

CI runs the browser tests against Svelte 5.57.0 with Kit 3.0.0, against the newest release of both, with Svelte's async mode turned on, and on Cloudflare's workerd runtime with and without an R2 store.

## How is this different from `content-visibility`?

`content-visibility` skips layout and paint for offscreen content. That helps rendering, but the HTML is still in your page, the data is still serialized, and the browser still has to hydrate everything.

It also has no effect on table rows. You can use both, though.

## How does this compare with Mochi?

[Mochi](https://github.com/khromov/mochi) by Stanislav Khromov is its own SSR framework for Svelte 5 on Bun, with islands built in. Several features here follow it (see [credits](80-credits.md)).

If you're on SvelteKit, you stay on SvelteKit here.

Deferred HTML also works differently. It lives at a URL named by a hash of its contents, so no props travel in the URL and the response can be cached forever, and a deferred island can still hydrate later.

## How does this compare with Astro?

Astro is a different framework that ships no JavaScript by default. If you've used its `client:*` directives, `when` does the same job.

Here you keep SvelteKit's routing, `load`, and client-side navigation, and each island's data lives at its own URL.

## Is it ready for production?

It's close, and we would like you to know exactly how close.

The library was built for [electionsarchive.com](https://electionsarchive.com), where an earlier version runs in production. The current design has a full test suite (including real browsers, the oldest supported versions, and Cloudflare's runtime) but has not yet been through production traffic, and 1.0 will wait until it has.

## Will search engines see my content?

A static island's HTML is in the page, so yes.

A deferred island's HTML is not in the first response, so a crawler that does not run JavaScript sees only the [outline](../20-core-concepts/20-islands.md#screen-readers) (its headings). You should use `defer` only for content you don't need indexed that way.

## How much JavaScript does it add?

About 10.5 KiB gzipped for `Island` alone, and 11.5 KiB for every client export together. CI fails if those go over 11.5 KiB and 12.5 KiB.
