---
title: Serverless functions
---

Node functions on platforms such as Vercel, Netlify, and AWS Lambda run the same code as `adapter-node`, though CI does not test them directly.

Their instances stop often and do not share memory, so you should pass a shared [store](20-stores.md):

```ts
/// file: src/hooks.server.ts
import { REDIS_URL } from "$app/env/private";
import { Redis } from "ioredis";
import { handle as islands } from "svelte-islands/server";
import { redisStore } from "svelte-islands/stores";

const client = new Redis(REDIS_URL);

export const handle = islands({
  store: redisStore(client, { ttl: 60 * 60 * 24 * 30 }),
});
```

Redis, R2, and S3 all suit this. `fileStore` does not, unless your instances share a persistent disk.

## Other runtimes

A runtime without `node:crypto`, such as Vercel's Edge runtime, is not supported. `part` has to hash its value synchronously, and Web Crypto can only hash asynchronously.
