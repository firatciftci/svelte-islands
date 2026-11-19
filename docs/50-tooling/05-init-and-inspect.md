---
title: Init and inspect
description: npx svelte-islands init sets up a SvelteKit app, and npx svelte-islands inspect reads a running page and reports its islands, with a JSON form for scripts and CI.
---

The CLI has two commands. `init` makes the setup changes for you, and `inspect` tells you what a running page actually sends.

## init

Run `init` in your app's directory:

```sh
npx svelte-islands init
```

It makes four changes:

- `src/hooks.ts` gets the transport, `export const transport = islands();`, which decodes parts in the browser
- `src/hooks.server.ts` gets the `handle` from `svelte-islands/server`
- `src/routes/+layout.svelte` imports the stylesheet, `svelte-islands/styles.css`
- the Vite config adds `islands()` from `svelte-islands/vite` next to `sveltekit()`

Each change happens only when it's missing. A file that already has the change is left alone, so running `init` again is safe. If your hooks file already has a `handle`, `init` renames it to `app` (or `app2`, if `app` is taken) and runs it after the islands' handle:

```ts
import { sequence } from "@sveltejs/kit/hooks";
import { handle as islands } from "svelte-islands/server";

const app = async ({ event, resolve }) => resolve(event);

export const handle = sequence(islands(), app);
```

A `handle` exported from a list, as in `export { auth as handle }`, gets the same treatment under a new name, so the list exports `handleWithIslands as handle`. An existing `transport` becomes the `codecs` that `islands()` keeps alongside its own.

If your app sets `paths.base` in its Vite or Svelte config, `init` gives the transport the matching prefix, such as `islands({ prefix: "/docs/_parts/" })`, so that the browser asks for parts under your base path. It can only read a plain string. When the base comes from somewhere else (`process.env.BASE_PATH`, for example), `init` prints a note, and you'll need to pass the prefix yourself.

Each step prints one line, which starts with one of four words:

- `created`: the file didn't exist, so `init` made it
- `updated`: the file existed, and `init` changed it
- `unchanged`: there was nothing to change
- `skipped`: `init` couldn't make the change, and the line says why

On a new SvelteKit app, the first run prints this:

```
created: src/hooks.ts
created: src/hooks.server.ts
created: src/routes/+layout.svelte
updated: vite.config.ts
```

A second run prints `unchanged` for all four. The exit code is 0 when no step was skipped, 1 when a step was skipped, and 2 when the directory has no `package.json`, or when `--store` names a store `init` doesn't know. Pass a directory as the argument to run `init` somewhere other than the current one.

### Choosing a store

By default the handle keeps parts in memory. Pass `--store` to set up a [store](../40-build-and-deploy/20-stores.md) instead:

```sh
npx svelte-islands init --store redis
```

- `redis` uses `redisStore` with a client from `ioredis` and the `REDIS_URL` environment variable, so install `ioredis` and set the variable
- `r2` uses `r2Store` with an R2 bucket bound as `PARTS`, and lowers `memory` to fit a Worker, as [Cloudflare Workers](../40-build-and-deploy/40-cloudflare-workers.md) explains
- `none` keeps parts in memory, which is the default

The store only goes in when `init` writes the handle. If your hooks already use svelte-islands, add the store yourself.

## inspect

`inspect` reads a page from a running app, so start the app first, with `vite preview` or your server's build. Then pass it a URL:

```sh
npx svelte-islands inspect http://127.0.0.1:4321/shell
```

Here is the output for a shell page from the svelte-islands test app:

```
http://127.0.0.1:4321/shell
  html 21.7 KiB, 3.6 KiB gzipped, 1.6 KiB of inline scripts
  only the island boot runs (csr = false), speculation rules prerender on hover
  4 islands
    shell.static, server HTML, part 7.5 KiB (1.4 KiB gzipped), code in its own chunk, hydrates on interaction, gets greeting, count
    shell.small, server HTML, part 19 B (39 B gzipped), code in its own chunk, hydrates on interaction, gets count
    shell.deferred, deferred HTML, part 8.1 KiB (1.5 KiB gzipped), code in its own chunk, hydrates on interaction
    shell.client, rendered in the browser, part 7.5 KiB (1.4 KiB gzipped), code in its own chunk, hydrates on visible
```

The first lines cover the page. They give the HTML's size, raw and gzipped, and how much of it is inline script. `inspect` requests uncompressed HTML and compresses it itself, so the numbers don't depend on your proxy. Next is what runs in the browser: SvelteKit hydrates the page, only the island boot runs, or no JavaScript runs islands. If the page has speculation rules, that's listed too.

Each island gets a line. It says where the island's HTML came from (server HTML, deferred HTML, fresh HTML, or rendered in the browser), the size of its part, whether its code is in its own chunk or in the page, when it hydrates, how many more parts it reads, and, on a page with `csr = false`, which page values it gets.

Two options change the output:

- `--json` prints one JSON object instead of the text
- `-p, --prefix <path>` sets the URL prefix of parts, which is `/_parts/` by default. Match it to the prefix you passed to `islands()`, if you changed it.

The JSON form of the same page looks like this:

```json
{
  "url": "http://127.0.0.1:4321/shell",
  "html": { "raw": 22223, "gzip": 3701, "inline": 1638 },
  "client": "islands",
  "speculation": "prerender",
  "islands": [
    {
      "hash": "F4N0gOhBo9VfKvyQVaKS6T",
      "name": "shell.static",
      "state": "static",
      "module": "TLQGMdYBx7XL",
      "file": null,
      "needs": 0,
      "part": { "raw": 7688, "gzip": 1481 },
      "hydrate": ["interaction"],
      "scope": ["greeting", "count"],
      "context": ["label", "Symbol.for(\"svelte-islands:tone\")"]
    }
  ]
}
```

`client` is `sveltekit`, `islands`, or `none`, and `speculation` is `prefetch`, `prerender`, or `null`. An island's `state` is `static`, `deferred`, `client`, or `fresh`, and its `module` is set when its code has its own chunk. `part` is `null` when the part can't be fetched. On a page with `csr = false`, `hydrate`, `scope`, and `context` come from the boot's payload. For an island the boot didn't send, they're `null`. The text output adds "not sent by the boot, so it stays as server HTML" to its line. See [Shell pages](../20-core-concepts/80-shell-pages.md) for the cases where that happens.

The exit codes are 0 when the page was read, whatever it holds, 1 when the page couldn't be fetched, and 2 when the command is wrong, such as a missing URL or an unknown option.

A zero exit doesn't mean the islands are right, so check the JSON in CI. This command fails the step when an island has no chunk of its own, or when the boot didn't send it, on a page with `csr = false`:

```sh
npx svelte-islands inspect http://localhost:4173/shell --json | jq -e '[.islands[] | select(.module == null or .hydrate == null)] | length == 0'
```

`jq -e` exits with 1 when its result is false, which fails the step. The check needs `jq` on the machine, and it doesn't apply to pages with SvelteKit's client, which don't send the boot's payload.
