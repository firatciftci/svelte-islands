# svelte-islands

Islands for SvelteKit. Heavy parts of a page render on the server as plain HTML, and the browser downloads their data and hydrates them only when they're needed: when they scroll into view, when the browser is idle, or when someone interacts with them. Client-side navigation keeps working, and while a part's data loads, the island shows a skeleton generated from what it rendered last time.

## Why

A SvelteKit page ships its load data twice: once as HTML and once as serialized data for hydration. For a page with a large table, map, or chart, the serialized copy can be several megabytes that the browser parses before anything is interactive. svelte-islands takes that data out of the page. Each part is stored under a hash of its contents and served from its own immutable URL, so browsers and CDNs can cache it for good.

## Install

```sh
pnpm add svelte-islands
```

svelte-islands needs SvelteKit 3 and Svelte 5.57 or later.

## Setup

Register the transport in `src/hooks.ts`. If you already have transport codecs, pass them in.

```ts
import { islands } from "svelte-islands";

export const transport = islands();
```

Add the server handle in `src/hooks.server.ts`. It serves parts at `/_parts/<hash>` and adds learned skeletons to each page. If you have other handles, put it in your `sequence`.

```ts
import { handle as islands } from "svelte-islands/server";

export const handle = islands();
```

Import the styles once, for example in your root layout:

```ts
import "svelte-islands/styles.css";
```

## Usage

Wrap a value from a server load function in `part`, giving it a name:

```ts
import { part } from "svelte-islands/server";

export const load = async () => ({ rows: part("results.rows", await rows()) });
```

Render it with `Island`. The snippet receives the value:

```svelte
<script lang="ts">
  import { Island } from "svelte-islands";

  const { data } = $props();
</script>

<Island part={data.rows} when="visible">
  {#snippet children(rows)}
    <ResultsTable {rows} />
  {/snippet}
</Island>
```

On the first page load, the island's HTML comes from the server and stays static until the `when` strategy fires. Then the island fetches its data and hydrates. A click on a button inside the island before then is held and replayed once the island is live. When you navigate to the page from elsewhere in the app, the island shows a skeleton until its data arrives.

### Strategies

| `when`                  | Hydrates                                                |
| ----------------------- | ------------------------------------------------------- |
| `interaction` (default) | on the first pointer, focus, or touch inside the island |
| `visible`               | when the island comes within 320px of the viewport      |
| `idle`                  | when the browser is idle                                |
| `eager`                 | right away                                              |
| `never`                 | never; the island stays as server HTML                  |

### Props

- `part`: the value returned by `part()`.
- `when`: the hydration strategy.
- `view`: a name for this rendering, when the same part renders in more than one way. Each view learns its own skeleton.
- `failed`: a snippet shown when the data can't be loaded. It receives a `retry` function.
- `class`: a class for the island's wrapper.

### Reading parts in script

`peek(part)` returns `{ value }` if the part's data is already in memory and `null` otherwise. It's reactive, so a `$derived` that reads it updates when the data arrives. `load(part)` returns a promise of the value.

## How it works

- **Content-addressed parts.** `part()` serializes the value with devalue, hashes it, and keeps the text in memory and in your store. Parts of 4,096 characters or less are inlined into the page instead.
- **Rebuilds.** If a part's URL is requested after the server has forgotten it, the client asks again with the page it came from, and the server reruns that page's load to recover it. If the data has changed since, the page reloads its data.
- **Learned skeletons.** The server turns each island's rendered HTML into a skeleton made of bars and blocks, and the client does the same from the live DOM. Skeletons are kept per part name and view, and sent with pages that need them, so you don't write skeletons by hand.
- **Compact transport.** The transport adds codecs for sparse arrays, runs of integers, and arrays of objects with the same keys, which it sends as columns.

## Options

`islands({ codecs, inline, prefix })`

- `codecs`: your own transport codecs.
- `inline`: the largest part, in characters, that is inlined into the page. The default is 4096.
- `prefix`: the URL prefix for parts. The default is `/_parts/`.

`handle({ store, memory, prepare })`

- `store`: an object with `get(key)` and `set(key, text)` that persists parts and skeletons across restarts and servers, such as Redis.
- `memory`: how many characters of parts to keep in memory. The default is 67,108,864 (64 × 1024²).
- `prepare(request, event)`: lets you adjust the internal request used to rebuild a part, for example to add a header your load functions read.

## Styling

Skeletons inherit the island's text color. Set these custom properties to change them:

- `--island-bone`: the color of skeleton bars.
- `--island-radius`: their corner radius.
- `--island-pulse`: the length of the pulse animation.

The pulse stops when the user prefers reduced motion.

## License

MIT
