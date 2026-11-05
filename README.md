# svelte-islands

Islands for SvelteKit. Heavy parts of a page render on the server as plain HTML, and the browser downloads their data and hydrates them only when they're needed: when they scroll into view, when the browser is idle, when a media query matches, or when someone interacts with them. An island can also leave its HTML out of the page entirely and fetch it as it nears the viewport. Client-side navigation keeps working, and while a part's data loads, the island shows a skeleton generated from what it rendered last time.

Guides: [Moving a page to islands](docs/migrating.md) and [Troubleshooting](docs/troubleshooting.md).

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

Add the server handle in `src/hooks.server.ts`. It serves parts, deferred HTML, and learned skeletons under `/_parts/`. If you have other handles, put it in your `sequence`.

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

On the first page load, the island's HTML comes from the server and stays static until the `when` strategy fires. Then the island fetches its data and hydrates. If someone clicks a button inside the island before then, the island holds the click, hydrates, and replays it as a full press, so controls that open on pointer events respond too. When you navigate to the page from elsewhere in the app, the island shows a skeleton until its data arrives.

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

Screen readers can reach an island before it loads. A deferred or client-only island puts a visually hidden outline in the page, built from the server's rendering: its headings with their ids, inside the named regions that hold them. The real content replaces the outline when it arrives. The server caches each outline by part, view, and `vary` value, so a client-only island doesn't render on every request. The server stops rendering that view as an outline for ten minutes after three renders with no headings, as with a map.

If a deferred island's HTML can't be fetched, it renders in the browser instead.

### Fetching a part's data

`part()` takes an options object as its third argument. Its `fetch` option sets when the browser downloads the part's data:

- `auto` (the default): on the first page load, the browser downloads the data when the island needs it. When someone navigates to the page from elsewhere in the app, the browser starts downloading it as soon as the page's data arrives. If a link uses `data-sveltekit-preload-data="hover"`, the download can start as soon as someone hovers over the link on SvelteKit 3.1 or later, and when they click it on 3.0. Use `lazy` for data that is expensive to download.
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
- `as`: the wrapper's tag, `div` by default. Use `tbody` to put an island inside a table. See [Long tables](#long-tables).

### Reading parts in script

`peek(part)` returns `{ value }` if the part's data is already in memory and `null` otherwise. It's reactive, so a `$derived` that reads it updates when the data arrives. `load(part)` returns a promise of the value.

### Clicks before hydration

An island holds the clicks that land inside it once its code has loaded. A click can also land before any of your code has loaded. To keep that click, remember it in a small inline script in `app.html`, then pass it to `replay(target, press)` when the root layout hydrates:

```html
<script>
  (() => {
    let early = null;
    const hold = (event) => {
      const target = event.target.closest?.('button, [role="button"]');
      if (
        target &&
        target.closest("a[href]") == null &&
        !(target.type === "submit" && target.form != null)
      )
        early = { event, target };
    };
    addEventListener("click", hold, true);
    window.takeEarlyClick = () => {
      removeEventListener("click", hold, true);
      return early;
    };
  })();
</script>
```

```svelte
<script>
  import { replay } from "svelte-islands";

  $effect(() => {
    const early = window.takeEarlyClick();
    if (early?.target.isConnected) {
      replay(early.target, early.event);
    }
  });
</script>
```

The script skips links and submit buttons because the browser has already acted on those clicks. `replay` dispatches the pointer, mouse, and click events of a real press, in order, with the original coordinates and modifier keys. A click from the keyboard or a screen reader has a `detail` of 0, and `replay` repeats it with `target.click()`.

### Long lists

`unroll(initial)` renders a long list a piece at a time. Its `limit` starts at `initial`. Put an empty element right after the last item you render and attach `tail(total)` to it. When that element is on screen or within a screen's height below it, `limit` grows by a few items each frame until the element moves out of range or `limit` reaches `total`. Growth stops once the element scrolls above the screen, so the list doesn't push down what someone is reading below it in a browser without scroll anchoring. The number of items per frame adapts so that rendering them takes about 8 ms. The tail copies the class and the shape of the item before it, so it shows a skeleton of the next item until that item renders, and it is hidden from screen readers.

```svelte
<script lang="ts">
  import { unroll } from "svelte-islands";

  const { rows } = $props();
  const shelf = unroll(50);
</script>

<ol>
  {#each rows.slice(0, shelf.limit) as row (row.id)}
    <li>{row.name}</li>
  {/each}
  {#if shelf.limit < rows.length}
    <li {@attach shelf.tail(rows.length)}></li>
  {/if}
</ol>
```

### Long tables

A table with thousands of elements takes a long time to hydrate in one go, and a `div` can't sit between a `table` and its rows. There are two ways to handle one.

If the table starts below the fold, defer it. The page then holds only a skeleton, and the rows arrive when someone scrolls close to the table. The skeleton keeps the first few rows and adds one spacer row for the rest, so the table holds about the right height while it waits. Set `--island-item` to the height of a row so that the spacer matches.

```svelte
<div style="--island-item: 2.75rem">
  <Island part={data.rows} defer when="visible">
    {#snippet children(rows)}
      <ResultsTable {rows} />
    {/snippet}
  </Island>
</div>
```

If the table is near the top of the page, or its HTML has to be in the page, split it into a `tbody` per chunk with `as="tbody"`. Each chunk hydrates on its own when it comes into view, and all the chunks share one part, so the data downloads once.

```svelte
<table>
  <thead>...</thead>
  {#each ["0", "1", "2"] as chunk (chunk)}
    <Island part={data.rows} view={chunk} as="tbody" when="visible">
      {#snippet children(rows)}
        {#each rows.slice(Number(chunk) * 100, (Number(chunk) + 1) * 100) as row (row.id)}
          <tr><td>{row.name}</td></tr>
        {/each}
      {/snippet}
    </Island>
  {/each}
</table>
```

`as="tbody"` needs its server HTML in the page, because a skeleton's wrapper can't live inside a table. It throws an error if you combine it with `defer` or `ssr={false}`.

### Printing, find in page, and no JavaScript

Content that hasn't loaded still prints, and people can still find it. When the browser is about to print, each static island hydrates, each deferred island fetches its HTML, and each `unroll` list renders every item. Browsers don't wait for asynchronous work after `beforeprint`, so these steps use synchronous requests; this is the only time the library blocks the main thread on the network. When someone presses Ctrl+F or Cmd+F, islands start loading as they would on scroll, and `unroll` lists keep growing, so their text becomes searchable. Choosing Find from the browser's menu sends the page no event, so the library can't react to it.

A client-only island has no server HTML and is often a map, so it joins in only if it has an outline. Maps with no headings never load because of printing or a search, and any skeleton left over is hidden on paper.

Without JavaScript, `@media (scripting: none)` hides skeletons and shows outlines as plain headings, so the page needs no `<noscript>` for them. The content itself can't arrive without JavaScript, so link to another copy of it if you have one.

Your own lazy content can join in with `whenWanted(run)`. It calls `run("print")` or `run("find")` and returns a function that stops listening. Do the work for `"print"` synchronously: `loadNow(part)` returns `{ value }` for a part, using a synchronous request if it has to, or `null` if the request fails.

### Other things that load

A region that isn't an island can still have to wait for something: a promise streamed from a load function, a lazy `import()`, or a client query. `Await` and `Pending` give those regions the same learned skeletons, so you don't write placeholders by hand.

`Await` takes a promise and a name, and it passes the resolved value to its snippet:

```svelte
<Await promise={data.counties} name="election.counties" reserve="24rem">
  {#snippet children(counties)}
    <Counties {counties} />
  {/snippet}
</Await>
```

`Pending` takes a boolean, which suits a query's `isPending`:

```svelte
<Pending name="figures" isPending={query.isPending} reserve="2rem">
  <Figures data={query.data} />
</Pending>
```

- `name`: the name the skeleton is learned under. Part names and these names share one namespace, so an `Island` and an `Await` with the same name use the same skeleton.
- `reserve`: a CSS block size to hold open before anything has been learned. Set it close to the content's height so that the page doesn't jump on a first visit.
- `failed`: on `Await` only, a snippet that receives the error if the promise rejects.
- `class`: a class for the wrapper.

Neither component adds a box, so the content and its skeleton keep their places in a parent grid or flex layout. If a `Pending` is replaced by content it doesn't wrap, such as a map in another branch of an `{#if}`, attach `learn(name)` to the element that holds that content:

```svelte
{#if view == null}
  <Pending name="map" isPending={true} reserve="32rem" />
{:else}
  <div {@attach learn("map")}><Map {view} /></div>
{/if}
```

## How it works

- **Content-addressed parts.** `part()` serializes the value, hashes it, and keeps the text in memory and in your store. Parts of 4,096 characters or less are inlined into the page instead. Deferred HTML is stored the same way, at `/_parts/<hash>.html`.
- **Rebuilds.** If a part or deferred HTML is requested after the server no longer has it, the client asks again with the page it came from, and the server reruns that page to recover it. If the data has changed since, the page reloads its data.
- **Retries.** A failed fetch is retried after 1, 3, and 5 seconds before the island shows its failure state. A part the server can no longer rebuild isn't retried.
- **Learned skeletons.** The server turns each island's rendered HTML into a skeleton made of bars and blocks, and the client does the same from the live DOM. A skeleton keeps the island's layout classes but drops content with no text or media, and it keeps only the first few of a run of repeated elements, such as table rows, so it stays under 12 KB. Table rows it leaves out become one spacer row that holds their height. `Await` also renders its children on the server once its promise resolves and learns from that HTML, so later visitors get a skeleton based on a server render that waited on streamed data. Skeletons are kept per part name and view. A page's HTML holds only the skeletons it shows right away. The client fetches the rest from `/_parts/skeletons` when it's idle, so that client-side navigation can show them, and it saves the skeletons it learns from the DOM in `localStorage`.
- **Part needs.** While the server renders an island, it records every other part the island reads and writes the ones that aren't inlined to `data-island-needs`. The browser loads them with the island's own part before it hydrates. Without this, the island could render differently from the server's HTML, and Svelte would clear that block until the part arrived.
- **Shared observers.** Islands with the same `margin` share one `IntersectionObserver`.
- **Scheduled hydration.** When several islands are ready at once, they hydrate one after another in slices of about 8 ms, and the browser gets the main thread back between slices to handle input and paint. Islands that hydrate on interaction go first, then `visible` and `eager` islands, then `media` islands, then `idle` ones. An island with a held click moves to the front. Islands that render in the browser, after a client-side navigation or with `ssr={false}`, go through the same queue.
- **Compact transport.** If a part's value is plain data (objects, arrays, strings, numbers, booleans, `null`, and `undefined`), it is sent as packed JSON rather than in devalue's format. Arrays of objects with the same keys are sent as columns. Repeated values, small objects, and lists are stored once and referred to by index. Runs of consecutive integers are sent as ranges, and arrays that are mostly zeros or nulls are sent as the positions of the other values. Arrays inside page data are packed the same way. Values such as dates, maps, and nested objects referenced from more than one place are sent in devalue's format. A small object of plain values referenced from several places arrives as separate copies. On our pages, packed parts were 3 to 7 times smaller than devalue's output, and about half the size after gzip.

## Measuring real users

`observe` calls your function with what each island does in the browser, so you can send real timings to your analytics. Call it once in your root layout, in the browser only:

```ts
import { browser } from "$app/env";
import { observe } from "svelte-islands";

if (browser) {
  observe((event) => {
    if (event.type === "hydrate") {
      navigator.sendBeacon("/metrics", JSON.stringify(event));
    }
  });
}
```

Each event has a `type`, plus the part's `name` and `hash`:

- `load`: the browser downloaded and decoded a part's data. Also has `bytes` and `duration`.
- `markup`: the browser downloaded a deferred island's HTML. Also has `bytes` and `duration`.
- `hydrate`: an island became interactive. Also has `when`, the strategy that woke it, and `duration`.
- `reveal`: content replaced a skeleton. `from` and `to` are the island's height in pixels before and after, so a large difference means the skeleton shifted the page.
- `fail`: a part or deferred HTML could not be downloaded. Also has `message`.

The library measures heights only while a listener is attached, so an app that never calls `observe` pays nothing for it.

## Private data

Parts larger than `inline` are stored under a hash of their contents and served from a public URL with `cache-control: public, immutable`. That is what makes them fast, and it also means anyone with the URL can read them, and any CDN or proxy between you and your visitors can keep a copy. Do not put anything that differs per visitor in an ordinary part.

Pass `private: true` for that data:

```ts
export const load = async ({ cookies }) => ({
  account: part("account", await accountFor(cookies), { private: true }),
});
```

The library never stores a private part or gives it a URL. It stays in the page's data, and SvelteKit sends it to the browser the same way it sends the rest of your load's data. An island that reads a private part renders as a static island: its HTML is in the page, it is not deferred to a public URL, and the library does not learn a skeleton from it. A private part nested inside a public part throws an error, because the outer part would publish it.

For content that comes from an `<Await>` rather than a part, set `<Await private>` so no skeleton is learned from it.

Skeletons remove text, attribute values, images, and URLs, but they keep the class names and layout of what they were learned from. Mark a part or `<Await>` as private if even that structure is sensitive.

In dev, the library warns when a public part is made during a request that has read cookies. Turn the warning off with `handle({ warnOnCookies: false })`.

## Stores

A store keeps parts, deferred HTML, and skeletons where every server can read them, so a server that restarted or never made a part doesn't have to rerun a page to recover it. `svelte-islands/stores` has ready-made ones:

```ts
import { Redis } from "ioredis";
import { handle as islands } from "svelte-islands/server";
import { compressed, redisStore } from "svelte-islands/stores";

const client = new Redis(process.env.REDIS_URL);

export const handle = islands({
  store: compressed(redisStore(client, { ttl: 60 * 60 * 24 * 30 })),
});
```

- `fileStore({ directory })`: files in a directory, for one server or several sharing a disk. Writes are atomic. It never deletes anything, so prune old files yourself.
- `redisStore(client, { prefix, ttl })`: Redis, with a client from `ioredis` or `redis`. `ttl` takes the expiry in seconds, and entries don't expire without it.
- `r2Store(bucket, { prefix })`: a Cloudflare R2 binding. See [Cloudflare Workers](#cloudflare-workers).
- `s3Store({ client, bucket, prefix, GetObjectCommand, PutObjectCommand })`: S3 or any service that speaks its API, through the AWS SDK. You pass in the two commands so that the library doesn't depend on the SDK.
- `compressed(store)`: gzips what another store keeps. It can still read entries stored uncompressed, so you can add it to a store that already has data.

You can also write your own: a store is any object with `get(key)` and `set(key, text)`, both returning promises.

A store is a cache, so a read or write that fails doesn't fail the request. The library reads the entry from memory or reruns the page instead. So that a serverless platform doesn't freeze a function in the middle of a write, the library hands its writes to `waitUntil` when the platform provides it, and otherwise holds the response for up to 1 second while they finish.

## Where it runs

CI runs the browser tests against Svelte 5.57.0 with Kit 3.0.0, against the newest release of both, with Svelte's async mode turned on, and on Cloudflare's workerd runtime with and without an R2 store.

### Node servers

Any Node adapter works. If you run more than one process, pass `handle()` a shared `store` so each process can serve parts another one made. Without a store, a process that doesn't have a part renders the page that made it again. These rebuilds are limited, so a burst of requests for missing parts can't overload the server. See `rebuild` under [Options](#options).

### Prerendered pages and static hosts

When SvelteKit prerenders a page, the library writes the page's parts, its deferred HTML, and the skeleton file into the build under `_parts/`. `adapter-static` and other static hosts serve them like any other file.

A static host has no server to rebuild a missing part, which leads to two differences:

- After a deploy, a visitor who still has an old page open can only load its parts if the host still has the old files. Keep the previous build's `_parts/` files in place for a while if that matters to you. Their names are hashes of their contents, so old and new files never collide.
- The skeleton file holds the shapes learned up to the moment the crawler requested it. A page that was crawled later still has its own skeletons in its HTML. A client navigation to that page can show a plain placeholder instead of a learned skeleton.

### Cloudflare Workers

Add the `nodejs_compat` flag, which the library needs for `node:crypto`, and bind a bucket:

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],
  "r2_buckets": [{ "binding": "PARTS", "bucket_name": "parts" }],
}
```

```ts
import { env } from "cloudflare:workers";
import { handle as islands } from "svelte-islands/server";
import { r2Store } from "svelte-islands/stores";

export const handle = islands({
  store: r2Store(() => env.PARTS),
  memory: 16 * 1024 * 1024,
});
```

Pass `r2Store` a function rather than the binding, because reading `env` during a prerender throws an error. Lower `memory` too: a Worker's limit is 128 MB, and the default keeps up to 64 MiB of parts.

Workers run without a store, but isolates don't share memory, so a part made in one is rebuilt in another. Use a store if you can.

### Serverless functions and other runtimes

Node functions on platforms such as Vercel, Netlify, and AWS Lambda run the same code as `adapter-node`, though CI doesn't test them directly. Their instances stop often and don't share memory, so pass a shared store such as Redis, R2, or S3. `fileStore` doesn't suit them unless the instances share a persistent disk.

A runtime without `node:crypto`, such as Vercel's Edge runtime, isn't supported. `part()` has to hash its value synchronously, and Web Crypto can only hash asynchronously.

### Svelte's async mode

Async mode works with or without `await` in your components. An island's server HTML has to render synchronously, though, so an island whose children use `await` can't be part of it. That island shows a skeleton and renders in the browser when it comes into view, and in dev the library logs a warning naming the part. To keep the island in the server HTML, load the data into its part.

## Service workers

`svelte-islands/sw` lets a page work offline once someone has visited it. Call `serveParts` first in your `fetch` listener. It returns `true` when it handled the request:

```ts
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
  // Handle your pages and assets here.
});
```

Parts and deferred HTML come from the cache first, because their names are hashes of their contents. The skeleton file comes from the network first, because it changes over time. The helper keeps the newest 500 entries. Pass `serveParts(event, { prefix, cache, limit })` to change the URL prefix, the cache's name, or that limit. If your app sets `paths.base`, the prefix has to include it.

## Tooling

### Budget check

`svelte-islands check` fetches your pages from a running server and fails if any of them is over its budget, so you can run it in CI or before a deploy. Put the budget in `islands.budget.json`. Limits are in KiB, and a page can have its own:

```json
{
  "limits": { "raw": 400, "gzip": 60, "inline": 150 },
  "pages": { "/": {}, "/largest-page": { "raw": 800 } }
}
```

```sh
npx svelte-islands check http://localhost:4173
```

`raw` is the size of the HTML, `gzip` is its compressed size, and `inline` is how much of it is inline script. The command exits with 0 when every page is within budget, 1 when a page is over, and 2 for a usage or configuration error. `--config <file>` points it at another budget file.

### ESLint rules

```js
import islands from "svelte-islands/eslint";

export default [islands.configs.recommended];
```

- `no-public-per-visitor-part` warns when a function that reads `cookies` or `locals` makes a part without `private: true`, and it can suggest adding it.
- `no-server-import-in-client` flags an import of `svelte-islands/server` in a component or a universal load file.
- `no-loaded-in-client` flags a read of `.loaded` in browser code. That value is only set where the part was made, so it's `null` in the browser for most parts. Use `peek` or `load` instead.
- `stable-part-name` warns when a part's name is built from data, because skeletons are learned per name and a new name never reuses one.

### Overlay

Render `Devtools` in development to see every island on the page, with its state, data size, and timings. It flags failed downloads, parts over 256 KiB, and skeletons that were off by more than 16 pixels. Those two limits are its `large` and `shift` props.

```svelte
<script lang="ts">
  import { dev } from "$app/env";
  import Devtools from "svelte-islands/devtools";
</script>

{#if dev}
  <Devtools />
{/if}
```

## Options

`islands({ codecs, inline, prefix })`

- `codecs`: your own transport codecs.
- `inline`: the largest part, in characters, that is inlined into the page. The default is 4096.
- `prefix`: the URL prefix for parts. The default is `/_parts/`. If your app sets `paths.base`, include it here, for example `/docs/_parts/`.

`handle({ store, memory, prepare, vary, rebuild, compress, warnOnCookies })`

- `store`: an object with `get(key)` and `set(key, text)` that persists parts, deferred HTML, and skeletons across restarts and servers. See [Stores](#stores).
- `memory`: how many characters of parts and deferred HTML to keep in memory. The default is 67,108,864 (64 × 1024²).
- `prepare(request, event)`: lets you adjust the internal request used to rebuild a part, for example to add a header your load functions read.
- `vary(event)`: returns any value other than an island's data that can change its text, such as the locale, so each value gets its own cached outline.
- `rebuild`: limits on rerunning a page to recover a part that this server doesn't have, usually because it restarted or another server made the part. Simultaneous requests for the same page share one run. `{ concurrency, queue, cooldown, timeout }` default to 4 runs at once, 32 waiting, 30 seconds before the same page can run again, and 30 seconds per run. When the queue is full, the server answers 503 and the browser retries. Pass `false` to answer 404 instead of rerunning anything.
- `compress`: serves parts of 1 KiB or more with Brotli when the browser accepts it, keeping the compressed copies in memory. The default is `true`. Turn it off if your proxy or CDN already compresses these responses.
- `warnOnCookies`: warns in dev when a public part is made during a request that has read cookies. The default is `true`.

## Styling

Skeletons inherit the island's text color. Set these custom properties to change them:

- `--island-bone`: the color of skeleton bars.
- `--island-radius`: their corner radius.
- `--island-pulse`: the length of the pulse animation.
- `--island-surface`: the background of a region that has no learned skeleton yet. The default is transparent.
- `--island-inset`: the padding of that region. The default is 0.
- `--island-item`: the height of the spacer row for each table row a skeleton leaves out. The default is `2em`.

The pulse stops when the user prefers reduced motion. While an island shows a skeleton and has no outline, its wrapper has `aria-busy="true"`. `data-island-state` is `static`, `deferred`, `client`, or `live`.

## Credits

Several features come from other projects:

- Client-only islands, deferred islands, the `margin` option, and retries with backoff follow [Mochi](https://github.com/khromov/mochi) by Stanislav Khromov: its `mochi:clientOnly` directive, its server islands (`mochi:defer`), the `rootMargin` option on `mochi:hydrate:visible`, and the retries on server-island fetches. svelte-islands differs in that deferred HTML lives at a URL named by a hash of its contents, so no props travel in the URL and the response can be cached forever, and a deferred island can still hydrate later.
- The `media` strategy follows Astro's `client:media` directive.

## License

MIT
