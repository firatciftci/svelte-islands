# Changelog

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
