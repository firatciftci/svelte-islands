---
title: Node servers
---

Any Node adapter works, and with a single long-running process you don't need to configure anything beyond [setup](../10-getting-started/20-setup.md).

The options here start to matter once a server can lose a part, or once you run more than one. They all go to `handle`:

```ts
/// file: src/hooks.server.ts
import { handle as islands } from "svelte-islands/server";

export const handle = islands({
  memory: 128 * 1024 * 1024,
  rebuild: { concurrency: 8 },
});
```

## Rebuilds

A server keeps its parts in memory, so a process that restarted has lost the parts it made, and a second process never had them. When the browser asks for one of these, the server reruns the page the part came from to make it again. We call this a _rebuild_.

A rebuild costs as much as a page view, and a burst of them (right after a deploy, for example) could overload your server. So they are limited:

- `concurrency` is how many pages can rerun at once, 4 by default
- `queue` is how many can wait for a turn, 32 by default
- `cooldown` is how long before the same page can rerun, 30,000 milliseconds by default
- `timeout` is how long each run can take, 30,000 milliseconds by default

Simultaneous requests for the same page share one run. When the queue is full, the server answers 503, and the browser retries.

If you would rather never rerun a page, pass `rebuild: false`. The server then answers 404, and the browser [reloads the page's data](../20-core-concepts/10-parts.md#when-a-part-goes-missing) once.

With more than one process, you should use a [store](20-stores.md), so that each process can read what the others made instead of rebuilding it.

## `memory`

`memory` is how many characters of parts and deferred HTML a process keeps in memory, and the default is 67,108,864 (64 × 1024²).

When a process goes over, the least recently used entries go first. A [store](20-stores.md) or a rebuild can bring them back.

## `vary`

An island's text can depend on more than its data. The locale is the usual example, since the same rows can render differently in French:

```ts
/// file: src/hooks.server.ts
export const handle = islands({ vary: (event) => event.locals.locale });
```

`vary` receives the request event and returns a string, and each string gets its own cached [outline](../20-core-concepts/20-islands.md#screen-readers).

## `prepare`

A rebuild is an internal request, so it carries only `accept-language` from the headers on the request that asked for the part. If your `load` functions read something else, you can add it:

```ts
/// file: src/hooks.server.ts
export const handle = islands({
  prepare: ({ headers }, event) => {
    headers.set("x-region", event.request.headers.get("x-region") ?? "");
  },
});
```

`prepare` receives the rebuild's `url` and `headers`, both of which you can change, and the event that asked for the part.

## `compress`

By default, the server sends parts of 1 KiB or more with Brotli when the browser accepts it, and keeps the compressed copies in memory.

If your proxy or CDN already compresses these responses, you should turn this off — something that compresses a response twice leaves the browser with garbage:

```ts
/// file: src/hooks.server.ts
export const handle = islands({ compress: false });
```
