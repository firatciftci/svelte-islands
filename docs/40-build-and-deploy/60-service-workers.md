---
title: Service workers
---

`svelte-islands/sw` lets a page work offline once someone has visited it. Call `serveParts` first in your `fetch` listener — it returns `true` when it handled the request:

```ts
/// file: src/service-worker/index.ts
import { version } from "$app/env";
import { assets, immutable } from "$app/manifest";
import { self } from "$app/service-worker";
import { serveParts } from "svelte-islands/sw";

const FILES = [...immutable, ...assets].map((file) => file.path);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(`assets-${version}`).then((cache) => cache.addAll(FILES)),
  );
});

self.addEventListener("fetch", (event) => {
  if (serveParts(event)) {
    return;
  }

  // handle your pages and assets here
});
```

Parts and deferred HTML come from the cache first, because their names are hashes of their contents, so an old copy can't be wrong.

The skeleton file comes from the network first, because it changes over time.

[Private parts](../60-best-practices/10-private-data.md) never reach this cache, because they have no URL.

## Options

The helper keeps the newest 500 entries. You can change that limit, the URL prefix, or the cache's name:

```ts
/// file: src/service-worker/index.ts
serveParts(event, { prefix: "/docs/_parts/", cache: "parts", limit: 1000 });
```

If your app sets `paths.base`, the prefix has to include it.
