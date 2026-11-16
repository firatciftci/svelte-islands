---
title: Running at scale
description: A worked example of moving a shop onto several Node processes behind a CDN, with a shared store, rebuilds after a deploy, a base path, and more.
---

With one long-running Node process, svelte-islands needs nothing beyond [setup](../10-getting-started/20-setup.md). Production is rarely that simple. Here a shop, served under `/shop`, moves onto several Node processes behind a CDN, and picks up the pieces that keep it fast and observable there: a shared store, limits sized for a deploy, locale handling, offline support, real-user timings, and a budget check in CI.

Each section adds one thing to the hooks file, and [the whole file](#the-whole-hooks-file) comes last.

## What changes with more than one process

A process keeps the parts it makes in memory. A second process never had them, and a process that restarts loses them, so when the browser asks for one, the server [reruns the page](../40-build-and-deploy/10-node-servers.md#rebuilds) that made it. That works, but each rerun costs as much as a page view, and a deploy restarts every process at once.

Skeletons are learned per process too, so without something shared, each process has to learn them for itself.

## A shared store

A [store](../40-build-and-deploy/20-stores.md) fixes both, because every process can read what the others wrote:

```ts
/// file: src/hooks.server.ts
import { REDIS_URL } from "$app/env/private";
import { Redis } from "ioredis";
import { handle as islands } from "svelte-islands/server";
import { compressed, redisStore } from "svelte-islands/stores";

const client = new Redis(REDIS_URL);

export const handle = islands({
  store: compressed(redisStore(client, { ttl: 60 * 60 * 24 * 30 })),
});
```

`compressed` gzips each entry before it reaches Redis, which matters when a page's parts run to megabytes. `ttl` lets entries expire after 30 days, so a tab left open for longer than that falls back to a rebuild. Without a `ttl`, entries never expire, and you will have to rely on Redis's own eviction (its `maxmemory-policy`, for example).

A store is a cache, so a read or write that fails does not fail the request. The library reads the entry from memory or reruns the page instead.

## Memory

Each process still keeps a copy of recent parts in memory, up to 64 MiB by default, so most requests never reach Redis. With a store behind it, that copy can be smaller:

```ts
/// file: src/hooks.server.ts
export const handle = islands({
  store: compressed(redisStore(client, { ttl: 60 * 60 * 24 * 30 })),
  memory: 32 * 1024 * 1024,
});
```

The limit counts characters of parts and deferred HTML, per process. Eight processes at the default would hold up to 512 MiB between them, so it's worth setting on purpose.

## Rebuilds after a deploy

With a store, a deploy does not lose any parts. A rebuild only happens for a part the store does not have (one that expired, or whose write failed), so they become rare. They are also still the thing most likely to hurt after a deploy, so it pays to size the limits:

```ts
/// file: src/hooks.server.ts
export const handle = islands({
  store: compressed(redisStore(client, { ttl: 60 * 60 * 24 * 30 })),
  memory: 32 * 1024 * 1024,
  rebuild: { concurrency: 2, queue: 64 },
});
```

The limits are per process, so multiply by your process count to see the worst case for your database. Eight processes at the default `concurrency` of 4 can rerun 32 pages at once. Here each process reruns two at a time, and up to 64 more wait for a turn.

When the queue is full, the server answers 503 with `retry-after: 1`, and the browser tries again after 1, 3, and 5 seconds. A longer queue turns more of those 503s into a short wait.

## Behind a CDN

Parts and deferred HTML are served with `cache-control: public, max-age=31536000, immutable`, so your CDN can keep them for good. The skeleton file gets `public, max-age=600, stale-while-revalidate=86400`, since it changes as the library learns. A 404 or 503 is sent with `no-store`, so a CDN will not hold on to a miss.

By default, the server also compresses parts with Brotli and keeps the compressed copies in memory. If your CDN compresses responses itself, turn that off, because something that compresses a response twice leaves the browser with garbage:

```ts
/// file: src/hooks.server.ts
export const handle = islands({
  store: compressed(redisStore(client, { ttl: 60 * 60 * 24 * 30 })),
  memory: 32 * 1024 * 1024,
  rebuild: { concurrency: 2, queue: 64 },
  compress: false,
});
```

It saves each process the memory for those copies, too.

## Locales and forwarded headers

The shop shows prices in the visitor's language, and the same rows read differently in French. An island's text then depends on more than its data, so the library needs to know the locale through [`vary`](../40-build-and-deploy/10-node-servers.md#vary):

```ts
/// file: src/hooks.server.ts
import { type Handle, sequence } from "@sveltejs/kit/hooks";
import { handle as islands } from "svelte-islands/server";

const locale: Handle = async ({ event, resolve }) => {
  event.locals.locale = pickLocale(
    event.request.headers.get("accept-language"),
  );
  return resolve(event);
};

export const handle = sequence(
  locale,
  islands({ vary: (event) => event.locals.locale }),
);
```

The `locale` handle goes first, which may look like it breaks the rule about putting the library early. It does not, since `locale` never answers a request itself. The library answers requests for parts without calling the handles after it, and it calls `vary` for those requests too, so whatever `vary` reads has to be set before it runs.

A rebuild is an internal request, and it carries only `accept-language` from the request that asked for the part. The shop's CDN adds an `x-country` header, and the catalog's `load` reads it to choose a currency, so [`prepare`](../40-build-and-deploy/10-node-servers.md#prepare) forwards it:

```ts
/// file: src/hooks.server.ts
export const handle = islands({
  prepare: ({ headers }, event) => {
    headers.set("x-country", event.request.headers.get("x-country") ?? "");
  },
});
```

Your CDN has to send that header on requests for parts as well as pages, or the rebuild will not have it to forward.

Cookies are never forwarded, which is one more reason a public part must not depend on them (there's more on that in [An account page](40-account-page.md#keeping-shared-data-shared)).

## A base path

The shop lives under `/shop`, so it sets [`paths.base`](https://svelte.dev/docs/kit/configuration#paths). Parts live under the base path too, and the browser needs to know where:

```ts
/// file: src/hooks.ts
import { islands } from "svelte-islands";

export const transport = islands({ prefix: "/shop/_parts/" });
```

The same prefix appears in two more places below: the service worker, and the budget file's page paths.

## Offline

A [service worker](../40-build-and-deploy/60-service-workers.md) lets a page someone has visited work without a connection. `serveParts` takes the same prefix:

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
  if (serveParts(event, { prefix: "/shop/_parts/" })) {
    return;
  }

  // handle your pages and assets here
});
```

Parts come from the cache first, since an old copy of a content-addressed file cannot be wrong, and the skeleton file comes from the network first. [Private parts](../60-best-practices/10-private-data.md) never reach the cache, because they have no URL.

## Watching real visitors

Lab numbers tell you what is possible (on your machine, at least), and real visitors tell you what happened. [`observe`](../50-tooling/40-measuring.md) reports what each island does in the browser, and three of its events are worth collecting in production:

- `hydrate`, with `when` and `duration`, so you can see which islands people actually wake
- `reveal`, with `from` and `to`, so you can find skeletons that shift the page
- `fail`, with `message`, so you hear about failed downloads before anyone reports them

Collect them as they happen, and send them in one beacon when the page is hidden:

```ts
/// file: src/routes/+layout.ts
import { browser } from "$app/env";
import { type Observation, observe } from "svelte-islands";

if (browser) {
  const queue: Array<Observation> = [];

  observe((event) => {
    if (
      event.type === "hydrate" ||
      event.type === "reveal" ||
      event.type === "fail"
    ) {
      queue.push(event);
    }
  });

  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && queue.length > 0) {
      navigator.sendBeacon("/shop/metrics", JSON.stringify(queue.splice(0)));
    }
  });
}
```

`visibilitychange` is the last event a page can rely on, since `unload` often does not fire on phones, and `sendBeacon` finishes even after the page is gone.

The endpoint takes the batch and hands it to whatever stores your metrics:

```ts
/// file: src/routes/metrics/+server.ts
export async function POST({ request }) {
  const events: unknown = await request.json();
  if (Array.isArray(events)) {
    await recordIslandEvents(events);
  }
  return new Response(null, { status: 204 });
}
```

The library only measures heights while a listener is attached, so a page that never calls `observe` pays nothing for it.

## In development

The [overlay](../50-tooling/30-overlay.md) shows the same information while you work, for every island on the page, and flags failed downloads, parts over 256 KiB, and skeletons that were off by more than 16 pixels:

```svelte
<!--- file: src/routes/+layout.svelte --->
<script>
  import { dev } from "$app/env";
  import Devtools from "svelte-islands/devtools";

  let { children } = $props();
</script>

{@render children()}

{#if dev}
  <Devtools />
{/if}
```

## In CI

A page gets heavy one small change at a time, so the [budget check](../50-tooling/10-budget-check.md) runs on every pull request. The page paths include the base path, because the command adds each one to the URL you give it:

```json
/// file: islands.budget.json
{
  "limits": { "raw": 400, "gzip": 60, "inline": 150 },
  "pages": { "/shop/": {}, "/shop/products": { "raw": 800 } }
}
```

The workflow builds the app, starts it with a Redis service beside it (so that it runs as it does in production), waits for it to answer, and runs the check:

```yaml
/// file: .github/workflows/budget.yml
name: Page budget
on: pull_request

jobs:
  budget:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:8
        ports:
          - 6379:6379
    env:
      REDIS_URL: redis://localhost:6379
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: 24
      - run: npm ci
      - run: npm run build
      - run: PORT=4173 node build &
      - run: |
          for attempt in $(seq 30); do
            curl --silent --fail http://localhost:4173/shop/ > /dev/null && exit 0
            sleep 1
          done
          exit 1
      - run: npx svelte-islands check http://localhost:4173
```

The command exits with 1 when a page is over budget or can't be fetched, which fails the job. `node build` assumes the default output directory of `adapter-node`.

## After a deploy

Most of what goes wrong shows up in the first few minutes after a deploy:

- a burst of 503s on `/shop/_parts/` means the rebuild queue is full; the browser retries, but if it keeps happening, look at why the store is missing so many parts, then at the [rebuild limits](#rebuilds-after-a-deploy)
- a 404 followed by a second request with `?u=` is a rebuild, and that is normal on its own
- a 404 on both means the page no longer makes that part, because its data changed, and the browser reloads the page's data once
- a jump in `fail` events, or in the gap between `from` and `to` on `reveal` events, points at a change that broke a download or a skeleton

[Troubleshooting](../70-appendix/20-troubleshooting.md#requests-for-parts-return-503) covers each of these in more detail.

## The whole hooks file

```ts
/// file: src/hooks.server.ts
import { REDIS_URL } from "$app/env/private";
import { type Handle, sequence } from "@sveltejs/kit/hooks";
import { Redis } from "ioredis";
import { handle as islands } from "svelte-islands/server";
import { compressed, redisStore } from "svelte-islands/stores";

const client = new Redis(REDIS_URL);

const locale: Handle = async ({ event, resolve }) => {
  event.locals.locale = pickLocale(
    event.request.headers.get("accept-language"),
  );
  return resolve(event);
};

export const handle = sequence(
  locale,
  islands({
    store: compressed(redisStore(client, { ttl: 60 * 60 * 24 * 30 })),
    memory: 32 * 1024 * 1024,
    rebuild: { concurrency: 2, queue: 64 },
    compress: false,
    vary: (event) => event.locals.locale,
    prepare: ({ headers }, event) => {
      headers.set("x-country", event.request.headers.get("x-country") ?? "");
    },
  }),
);
```

## Making it your own

- if you run on Cloudflare Workers, use [`r2Store`](../40-build-and-deploy/40-cloudflare-workers.md) and a lower `memory`
- if your processes share a disk and not much else, `fileStore` works, but you'll have to prune old files yourself
- if your CDN doesn't compress, leave `compress` on
- if nothing on your pages depends on the locale, leave out `vary`
- if your app has no base path, drop every `/shop` and keep the defaults
