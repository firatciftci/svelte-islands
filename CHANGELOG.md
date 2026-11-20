# Changelog

## 1.1.0

### Breaking changes

- `observe` has two new event types, `prefetch` and `frame`, that carry no `name` or `hash` of their own, so a listener that reads `event.name` without checking `event.type` first no longer type-checks
- on pages with `csr = false`, the islands of a component now share one live copy of the page values they read, as islands on a SvelteKit page share the page's state, instead of each getting its own copy ([shell pages](https://firatciftci.github.io/svelte-islands/docs/core-concepts/shell-pages))
- every error and warning now starts with a stable code, such as `islands_part_after_cookies`, and ends with a link to that code's section in [errors and warnings](https://firatciftci.github.io/svelte-islands/docs/appendix/errors), so a log search for the old message text won't match

### Added

- with the Vite plugin, an island that has no `hydrate` prop and whose snippet nothing can change is inferred as `hydrate="never"`, so neither its data nor its code is downloaded; in development, `inspect`, the overlay, and the plugin's log say why each island hydrates or never does ([islands that never hydrate](https://firatciftci.github.io/svelte-islands/docs/core-concepts/vite-plugin#islands-that-never-hydrate))
- a pointer, focus, or touch inside an island that has not hydrated yet now downloads its data and code at high priority, through one delegated listener for the whole page, and moves an `interaction` island to the front of the queue
- the `prefetch` event in `observe`, sent when the page is hidden or the reader moves on, which says for each prefetched part whether an island used it, needed it before it arrived, or never read it
- the `frame` event in `observe`, which names the islands that hydrated in a long animation frame (Chromium only)
- OpenTelemetry spans for pages, parts, rebuilds, and fresh requests under SvelteKit's own spans, when SvelteKit's tracing is on; `@opentelemetry/api` is an optional peer dependency and isn't imported otherwise ([tracing on the server](https://firatciftci.github.io/svelte-islands/docs/tooling/measuring#tracing-on-the-server))
- `npx svelte-islands mcp`, an MCP server for coding agents with `inspect_page`, `check_budget`, `advise_page_data`, and `explain_island` tools ([coding agents](https://firatciftci.github.io/svelte-islands/docs/tooling/agents))
- `init --store redis|r2|none`, and `init` now writes the transport's `prefix` when the app sets `paths.base`, and handles hooks files that export `handle` from a list or already use the name `app`

### Changed

- an island now costs a SvelteKit page 10.5 KiB gzipped, down from 13.8 KiB in 1.0, measured on a SvelteKit app with and without one island; the size script now reports that number, along with what the transport adds to every page and what the Vite plugin adds to pages without islands
- the Vite plugin decides which pages are shell pages from each route's `csr` export, and falls back to the page's HTML only when it can't read the value; in development, it warns when the two disagree
- the prefetch docs now say that the 1 MiB budget is per page

### Fixed

- an app where every page has `csr = false` now gets the island boot; SvelteKit skips its client build in that case, so those pages shipped no script, fresh islands stayed as skeletons, and nothing hydrated
- a click on a `<button>` with no `type` outside a form now reaches the island it wakes; the button counted as a submit button with a native action, so the click was lost while the island's code loaded
- an island in `+layout.svelte` no longer makes SvelteKit warn that the layout doesn't render its children
- the browser learns an island's skeleton in a fraction of the time on long pages, because it stops drawing a skeleton as soon as it's too big to keep, instead of finishing it four times and throwing every copy away
- `part()` no longer serves an old copy of an object your app changed and passed in again; it cached each value's serialized form by object identity, so a module-level array kept its first version after an action pushed to it
- the server spends less time per page serializing parts: it reuses the serialized form of the same content across requests, and an inline part is no longer serialized twice (on a product page with a shell, server time per request fell from about 205 µs to 126 µs)
- `serveParts` from `svelte-islands/sw` no longer caches the answers to fresh islands' requests; it cached them by path, so a service worker could hand one visitor's fresh values to the next visit, even to a different visitor
- two islands of the same part on one page now get different id prefixes, so `$props.id()` inside them no longer hands both the same ids
- `init` finds `sveltekit()` in the Vite config with a parser, so a parenthesis inside a string or comment no longer makes it write `islands()` in the wrong place, and it leaves a config alone that already calls an `islands()` imported from somewhere else
- with `experimental.async`, a click that wakes an island now reaches it when the component uses `await` in its script; the click was replayed before the `await` finished, so the handler ran against state that didn't exist yet and the click was lost

## 1.0.1

### Fixed

- a page's query string no longer appears in its HTML: parts name only the path they came from, and the browser adds its own query when it asks for a rebuild, so a token in a link such as `/reset?token=...` can't end up in a cached copy of the page
- fresh requests for a page where the server hasn't yet seen fresh islands now wait behind the `rebuild` limits, and a page whose render had none answers 404 until the `cooldown` passes, so `/_parts/fresh` can't be used to render pages over and over bypassing the page cache; the browser retries a fresh request that gets 503
- a rebuild that runs with a visitor's cookies now stores only the part that was asked for, which was already public, and drops every other part it made
- the warning about fresh islands that can't render is logged once in production instead of once per path, and the set of shown warnings is capped, so neither the log nor memory grows with requests for made-up paths
- the prefetch budget is now 1 MiB per page, as documented, instead of 1 MiB for the whole visit, which stopped prefetching after a few client-side navigations

## 1.0.0

### Breaking changes

- `render` replaces `defer` and `ssr`: `defer` is now `render="deferred"`, and `ssr={false}` is now `render="client"`
- `reveal` replaces the strategy form of `defer`, so `defer="idle"` is now `render="deferred" reveal="idle"`
- `hydrate` replaces `when`, and takes one strategy or several, where the first to fire wins (`hydrate={["interaction", "idle"]}`)

### Added

- `islands()` from `svelte-islands/vite`, an optional Vite plugin that moves each island's code into its own chunk, so the code is held back along with the data ([the Vite plugin](https://firatciftci.github.io/svelte-islands/docs/core-concepts/vite-plugin))
- islands on pages with `export const csr = false`, where only the islands boot and SvelteKit's client never loads (needs the Vite plugin), along with `context(name)` for contexts that reach those islands, and `handle({ speculation, viewTransitions })` for Speculation Rules and cross-document View Transitions ([shell pages](https://firatciftci.github.io/svelte-islands/docs/core-concepts/shell-pages))
- `render="fresh"` and `fresh()` from `svelte-islands/server`, for islands that show each visitor their own data on a page you cache for everyone — one private request fills every fresh island on the page ([fresh islands](https://firatciftci.github.io/svelte-islands/docs/core-concepts/fresh-islands))
- the `prefetch` prop, on by default: once an island is near the viewport and the browser is idle, its data and code download at low priority (skipped on `Save-Data` and slow connections)
- text typed into fields and forms submitted before an island hydrates are now replayed after it does, as clicks already were
- `npx svelte-islands init`, which sets up the transport, the handle, the stylesheet, and the Vite plugin, and `npx svelte-islands inspect <url>`, which lists every island on a page (with `--json` for CI)
- `observe` reports what each island cost: `hydrate` events carry `code`, `data`, `html`, `delay`, and `isPrefetched`, and `load` events carry `isPrefetch`
- the overlay shows each island's code, HTML, and wait time, and a Page data table lists the page's data by size and points out values that should become parts

### Changed

- the skeleton learner loads on first use, and the packed-format encoder stays on the server, so `<Island>` costs 11.0 KiB gzipped up front, against 10.6 KiB in 0.8, even with the new lifecycle, prefetching, replay, and fresh islands
