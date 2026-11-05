# Troubleshooting

Render the [overlay](../README.md#tooling) first if you can. It lists every island on the page with its state, data size, and timings, and it flags failed downloads and skeletons that were off by more than 16 pixels.

## An island stays static and its controls don't respond

The island's data probably failed to load. Look in the console for `svelte-islands: could not load the part "name"`, followed by the error, and look at the request to `/_parts/<hash>` in the network panel.

- **The response looks like binary garbage, and its `content-encoding` is `br`.** Something compressed it twice. Your proxy or CDN may be compressing a response the library had already compressed, so pass `handle({ compress: false })`.
- **The request goes to the wrong path.** If your app sets `paths.base`, the prefix has to include it: `islands({ prefix: "/docs/_parts/" })`.
- **The response is a page of HTML.** Another handle answered first. Put the library's handle earlier in your `sequence`.
- **The value can't be decoded.** Register your own types by passing `codecs` to `islands()`.

## Requests for parts return 404

One 404 is normal. When a server doesn't have a part, usually because it restarted or another server made the part, the browser asks again with the page the part came from, and the server reruns that page to recover it.

If the second request also returns 404, the page no longer makes that part, because its data changed. The browser then reloads the page's data once. You'll see this right after publishing new data, and it recovers on its own.

To avoid the rerun altogether, pass `handle()` a [store](../README.md#stores).

## Requests for parts return 503

The rebuild queue is full, and the browser will retry. This means many visitors are asking for parts the server doesn't have, which often follows a deploy. A shared store fixes the cause. You can also raise `rebuild.concurrency` and `rebuild.queue`.

## The page jumps when an island loads

The skeleton was a different height from the content. A skeleton keeps only the first few of a run of repeated elements, so a long list's skeleton is shorter than the list. A table's skeleton uses one spacer row to reserve the height of its other rows. The spacer is `2em` per row unless you set `--island-item`.

- For a table, set `--island-item` on a wrapper around the island to the height of a row.
- Put the island below the fold. The browser fetches it 320 pixels before it comes into view by default, and content that grows below the viewport doesn't move what someone is reading.
- Give a wrapper around the island a `min-block-size` close to the content's height.
- On `Await` and `Pending`, set `reserve`.

The `reveal` event from `observe` reports the height before and after, so you can measure this for real visitors.

## Svelte warns about a hydration mismatch

The island rendered differently in the browser than on the server, so Svelte replaced that block. An island has the same causes as any other SvelteKit component: dates, random values, and anything that depends on the locale or time zone. The library records the other parts an island reads and loads them first, so a part read inside an island isn't usually the cause.

## An island shows a skeleton instead of its server HTML

An island's children used `await`. The server renders an island's HTML synchronously, so it can't wait. In dev, the library logs a warning naming the part. Load the data into the part instead.

## Table rows end up outside the table

An island's wrapper is a `div`, and the HTML parser moves a `div` out of a `table`. Pass `as="tbody"`. That mode needs server HTML in the page, so it throws an error if you combine it with `defer` or `ssr={false}`.

## A link to an anchor doesn't land

The id is inside a deferred or client-only island, and that island's HTML isn't in the page yet. The outline keeps only headings that have ids, inside the named regions that hold them. Put any other id on an element outside the island.

## Printing or find in page misses content

Each island brings its content in when the browser is about to print or when someone presses Ctrl+F or Cmd+F. Choosing Find from the browser's menu sends the page no event, so the library can't react to it. A client-only island with no headings has no outline, and it doesn't load for printing or searching.

## A part with personal data got a public URL

A part without `private: true` is stored under a public, immutable URL, and caches along the way can keep a copy. Add `private: true`, and treat anything that already went out as public. In dev, the library warns when a public part is made during a request that has read cookies, and the `no-public-per-visitor-part` ESLint rule catches common cases as you write.

## Cloudflare Workers

- **`No such module "node:crypto"` or a similar build error.** Add `nodejs_compat` to `compatibility_flags` in your Wrangler config.
- **`Cannot access cloudflare:workers in a prerenderable route`.** Something read `env` while the module was loading, and at least one of your routes prerenders. Pass a function: `r2Store(() => env.PARTS)`.
- **The worker runs out of memory.** A Worker's limit is 128 MB, and the library keeps up to 64 MiB of parts in memory. Lower it with `handle({ memory })`.

## The service worker serves an old copy

`serveParts` serves parts from its cache first because their names are hashes of their contents, so an old copy can't be wrong. Only the skeleton file comes from the network first. If your app sets `paths.base`, pass the same prefix: `serveParts(event, { prefix: "/docs/_parts/" })`.
