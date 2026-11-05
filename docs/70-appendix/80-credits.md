---
title: Credits
---

Several features here come from other projects:

- client-only islands, deferred islands, the `margin` option, and retries with backoff follow [Mochi](https://github.com/khromov/mochi) by Stanislav Khromov: its `mochi:clientOnly` directive, its server islands (`mochi:defer`), the `rootMargin` option on `mochi:hydrate:visible`, and the retries on server-island fetches
- the `media` strategy follows the `client:media` directive in [Astro](https://astro.build)

Deferred islands differ from Mochi's server islands in one way. The HTML lives at a URL named by a hash of its contents, so no props travel in the URL and the response can be cached forever, and a deferred island can still hydrate later.

The writing in these docs follows the [Svelte docs](https://svelte.dev/docs), which we think are some of the best around.
