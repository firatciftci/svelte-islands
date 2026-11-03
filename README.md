# svelte-islands

Islands for SvelteKit. Heavy parts of a page render on the server as plain HTML, and the browser downloads their data and hydrates them only when they're needed: when they scroll into view, when the browser is idle, when a media query matches, or when someone interacts with them. An island can also leave its HTML out of the page entirely and fetch it as it nears the viewport. Client-side navigation keeps working, and while a part's data loads, the island shows a skeleton generated from what it rendered last time.

## Why

A SvelteKit page ships its load data twice: once as HTML and once as serialized data for hydration. For a page with a large table, map, or chart, the serialized copy can be several megabytes that the browser parses before anything is interactive. svelte-islands takes that data out of the page. Each part is stored under a hash of its contents and served from its own immutable URL, so browsers and CDNs can cache it for good. Deferred islands do the same for HTML, so a long table below the fold costs the page a small skeleton instead of hundreds of kilobytes of markup.

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

Add the server handle in `src/hooks.server.ts`. It serves parts and deferred HTML under `/_parts/` and adds learned skeletons to each page. If you have other handles, put it in your `sequence`.

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

| `when`                  | Hydrates                                                    |
| ----------------------- | ----------------------------------------------------------- |
| `interaction` (default) | on the first pointer, focus, or touch inside the island     |
| `visible`               | when the island comes within `margin` of the viewport       |
| `idle`                  | when the browser is idle                                    |
| `media`                 | when the `media` query matches, for example on wide screens |
| `eager`                 | right away                                                  |
| `never`                 | never; the island stays as server HTML                      |

### Rendering modes

An island renders in one of three ways on the first page load:

- **Static** (the default): the server renders the HTML into the page, and the island hydrates when `when` fires.
- **Deferred** (`defer`): the server renders the HTML but stores it under a hash of its contents instead of putting it in the page, and the page gets the island's skeleton. When the island nears the viewport, the browser fetches the HTML from its immutable URL, swaps it in for the skeleton, and the island then hydrates when `when` fires. If `when` is `visible` or `eager`, the island's data is fetched at the same time as its HTML. Use it for long content below the fold.
- **Client-only** (`ssr={false}`): the server sends only the skeleton, and the island renders in the browser when `when` fires, which defaults to `visible` in this mode. Use it for components that can't render on the server, or whose server HTML isn't worth sending. The server still renders the island now and then to learn its skeleton; if that render throws, the island falls back to a generic skeleton.

```svelte
<Island part={data.rows} defer when="visible">
  {#snippet children(rows)}
    <ResultsTable {rows} />
  {/snippet}
</Island>

<Island part={data.shapes} ssr={false} margin="600px">
  {#snippet children(shapes)}
    <Map {shapes} />
  {/snippet}
</Island>
```

If a deferred island's HTML can't be fetched, it renders in the browser instead.

### Fetching a part's data

`part()` takes an options object as its third argument. Its `fetch` option sets when the browser downloads the part's data:

- `auto` (the default): on the first page load, the browser downloads the data when the island needs it. When someone navigates to the page from elsewhere in the app, the browser starts downloading it as soon as the page's data arrives.
- `lazy`: the browser downloads the data only when the island needs it or when you call `load(part)`.
- `preload`: the browser starts downloading the data as soon as the page arrives. On the first page load, the server also adds a `<link rel="preload">` for the data to the page's head, as long as the part is ready before the server sends the head. Use it for data the page needs right away that is too large to inline, such as the data behind a chart at the top of the page.

```ts
export const load = async () => ({
  chart: part("results.chart", await chart(), { fetch: "preload" }),
});
```

### Props

- `part`: the value returned by `part()`.
- `when`: the hydration strategy. The default is `interaction`, or `visible` when `ssr` is `false`. You can change it after the island mounts: switching it to `eager` hydrates the island right away, for example when a control outside the island needs it to be live.
- `defer`: leave the island's HTML out of the page and fetch it later. `true` fetches it when the island nears the viewport; pass a strategy, such as `"idle"`, to fetch it at another time.
- `ssr`: set to `false` to render the island only in the browser.
- `margin`: how close to the viewport the island must come for `visible` to fire, as a CSS margin. The default is `320px`.
- `media`: the media query for the `media` strategy, such as `"(min-width: 64rem)"`.
- `view`: a name for this rendering, when the same part renders in more than one way. Each view learns its own skeleton.
- `failed`: a snippet shown when the data can't be loaded. It receives a `retry` function.
- `class`: a class for the island's wrapper.

### Reading parts in script

`peek(part)` returns `{ value }` if the part's data is already in memory and `null` otherwise. It's reactive, so a `$derived` that reads it updates when the data arrives. `load(part)` returns a promise of the value.

## How it works

- **Content-addressed parts.** `part()` serializes the value, hashes it, and keeps the text in memory and in your store. Parts of 4,096 characters or less are inlined into the page instead. Deferred HTML is stored the same way, at `/_parts/<hash>.html`.
- **Rebuilds.** If a part or deferred HTML is requested after the server no longer has it, the client asks again with the page it came from, and the server reruns that page to recover it. If the data has changed since, the page reloads its data.
- **Retries.** A failed fetch is retried after 1, 3, and 5 seconds before the island shows its failure state. A part the server can no longer rebuild isn't retried.
- **Learned skeletons.** The server turns each island's rendered HTML into a skeleton made of bars and blocks, and the client does the same from the live DOM. A skeleton keeps the island's layout classes but drops content with no text or media, and it keeps only the first few of a run of repeated elements, such as table rows, so it stays under 12 KB. Skeletons are kept per part name and view, and sent with pages that need them, so you don't write skeletons by hand.
- **Shared observers.** Islands with the same `margin` share one `IntersectionObserver`.
- **Compact transport.** If a part's value is plain data (objects, arrays, strings, numbers, booleans, `null`, and `undefined`), it is sent as packed JSON rather than in devalue's format. Arrays of objects with the same keys are sent as columns. Repeated values, small objects, and lists are stored once and referred to by index. Runs of consecutive integers are sent as ranges, and arrays that are mostly zeros or nulls are sent as the positions of the other values. Arrays inside page data are packed the same way. Values such as dates, maps, and nested objects referenced from more than one place are sent in devalue's format. A small object of plain values referenced from several places arrives as separate copies. On our pages, packed parts were 3 to 7 times smaller than devalue's output, and about half the size after gzip.

## Options

`islands({ codecs, inline, prefix })`

- `codecs`: your own transport codecs.
- `inline`: the largest part, in characters, that is inlined into the page. The default is 4096.
- `prefix`: the URL prefix for parts. The default is `/_parts/`.

`handle({ store, memory, prepare })`

- `store`: an object with `get(key)` and `set(key, text)` that persists parts, deferred HTML, and skeletons across restarts and servers, such as Redis.
- `memory`: how many characters of parts and deferred HTML to keep in memory. The default is 67,108,864 (64 × 1024²).
- `prepare(request, event)`: lets you adjust the internal request used to rebuild a part, for example to add a header your load functions read.

## Styling

Skeletons inherit the island's text color. Set these custom properties to change them:

- `--island-bone`: the color of skeleton bars.
- `--island-radius`: their corner radius.
- `--island-pulse`: the length of the pulse animation.

The pulse stops when the user prefers reduced motion. While an island shows a skeleton, its wrapper has `aria-busy="true"`, and `data-island-state` is `static`, `deferred`, `client`, or `live`.

## Credits

Several features come from other projects:

- Client-only islands, deferred islands, the `margin` option, and retries with backoff follow [Mochi](https://github.com/khromov/mochi) by Stanislav Khromov: its `mochi:clientOnly` directive, its server islands (`mochi:defer`), the `rootMargin` option on `mochi:hydrate:visible`, and the retries on server-island fetches. svelte-islands differs in that deferred HTML lives at a URL named by a hash of its contents, so no props travel in the URL and the response can be cached forever, and a deferred island can still hydrate later.
- The `media` strategy follows Astro's `client:media` directive.

## License

MIT
