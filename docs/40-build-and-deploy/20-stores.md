---
title: Stores
---

A _store_ keeps parts, deferred HTML, and skeletons where every server can read them, so that a server that restarted (or never made a part) does not have to [rerun a page](10-node-servers.md#rebuilds) to get it back:

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

You should use one if you run more than one process, or if your processes restart often. With a single long-running process you probably don't need it.

## Ready-made stores

`svelte-islands/stores` includes four:

- `fileStore({ directory })` keeps files in a directory, for one server or several that share a disk — writes are atomic, and it never deletes anything, so you'll need to prune old files yourself
- `redisStore(client, { prefix, ttl })` uses a client from `ioredis` or `redis`, where `ttl` is the expiry in seconds (entries do not expire without it)
- `r2Store(bucket, { prefix })` uses a Cloudflare R2 binding, and there's more on that in [Cloudflare Workers](40-cloudflare-workers.md)
- `s3Store({ client, bucket, prefix, GetObjectCommand, PutObjectCommand })` works with S3 or any service that speaks its API — you pass in the two commands from the AWS SDK, so that the library does not have to depend on it

## Compression

`compressed(store)` gzips what another store keeps.

It can still read entries stored uncompressed, so you can add it to a store that already has data.

## Writing your own

A store is any object with `get` and `set`, both returning promises. `get` resolves to the text, or `null` if there is nothing there:

```ts
const store = {
  get: (key) => my_cache.read(key),
  set: (key, text) => my_cache.write(key, text),
};
```

Keys and values are always strings.

## When a store fails

A store is a cache, so a read or write that fails does not fail the request. The library reads the entry from memory or reruns the page instead.

A serverless platform can freeze a function in the middle of a write, so the library hands its writes to `waitUntil` when the platform provides it. Otherwise it holds the response for up to 1 second while they finish.
