---
title: Cloudflare Workers
---

The library runs on Workers with [`adapter-cloudflare`](https://svelte.dev/docs/kit/adapter-cloudflare). Add the `nodejs_compat` flag, which the library needs for `node:crypto`, and bind a bucket...

```jsonc
/// file: wrangler.jsonc
{
  "compatibility_flags": ["nodejs_compat"],
  "r2_buckets": [{ "binding": "PARTS", "bucket_name": "parts" }],
}
```

...then pass the bucket to [`r2Store`](20-stores.md):

```ts
/// file: src/hooks.server.ts
import { env } from "cloudflare:workers";
import { handle as islands } from "svelte-islands/server";
import { r2Store } from "svelte-islands/stores";

export const handle = islands({
  store: r2Store(() => env.PARTS),
  memory: 16 * 1024 * 1024,
});
```

You should pass `r2Store` a function rather than the binding, because reading `env` during a prerender throws an error.

You should lower `memory` too. A Worker's limit is 128 MB, and the default keeps up to 64 MiB of parts.

Workers will run without a store, but isolates do not share memory, so a part made in one is [rebuilt](10-node-servers.md#rebuilds) in another. We recommend using a store if you can.

CI runs the browser tests on Cloudflare's workerd runtime, with and without an R2 store.

## If something goes wrong

- `No such module "node:crypto"`, or a similar build error, means that `nodejs_compat` is missing from `compatibility_flags` in your Wrangler config
- `Cannot access cloudflare:workers in a prerenderable route` means that something read `env` while the module was loading, and at least one of your routes prerenders — pass a function, as in `r2Store(() => env.PARTS)`
- if the Worker runs out of memory, lower the limit with `handle({ memory })`
