# Moving a page to islands

This guide moves an existing SvelteKit page onto svelte-islands one value at a time. The app keeps working after each step, so you can stop at any point and ship what you have.

## 1. Measure the page

Write down where the page stands, so you can tell what moved. Add a budget file named `islands.budget.json` to your project. The limits are in KiB, and a page can have its own limits.

```json
{
  "limits": { "raw": 400, "gzip": 60, "inline": 150 },
  "pages": { "/": {}, "/results": { "raw": 800 } }
}
```

Then run the check against a running copy of your app:

```sh
npx svelte-islands check http://localhost:4173
```

It prints each page's HTML size, its gzipped size, and how much of it is inline script. It exits with 1 when a page is over a limit, so you can run it in CI later.

## 2. Add the library

Follow [Setup](../README.md#setup) in the README. It takes three small edits: the transport in `src/hooks.ts`, the handle in `src/hooks.server.ts`, and the stylesheet in your root layout. Nothing changes on the page until you make a part.

## 3. Find the heavy values

Look at what your load functions return for the page. One or two values usually account for most of the serialized data: a long list of rows, a set of map shapes, or a chart's series. Start with the largest one.

## 4. Wrap the value in `part`

Give the value a name. The library captures the skeleton under this name, so keep the name stable.

```ts
import { part } from "svelte-islands/server";

export const load = async () => ({ rows: part("results.rows", await rows()) });
```

## 5. Render it in an island

Replace the place that reads the value with an `Island`:

```svelte
<Island part={data.rows}>
  {#snippet children(rows)}
    <ResultsTable {rows} />
  {/snippet}
</Island>
```

`data.rows` is now a `Part` rather than an array, so `svelte-check` flags every other place that read it. There are three ways to fix each one:

- **Move it inside.** If another component needs the same rows, render it in the same island, or give it its own island with the same part and a `view`.
- **Compute it on the server.** A total or a count doesn't need the whole list in the browser. Return it from `load` as its own small value.
- **Read it in script.** `peek(part)` returns `{ value }` once the data is in memory and `null` before that. `load(part)` returns a promise of the value.

## 6. Pick when it loads

| The content                                                | Use                                  |
| ---------------------------------------------------------- | ------------------------------------ |
| Mostly read, with a few controls                           | `when="interaction"`, the default    |
| A chart or map that should be live as soon as it's visible | `when="visible"`                     |
| Long and below the fold                                    | `defer when="visible"`               |
| Unable to render on the server                             | `ssr={false}`                        |
| Never interactive                                          | `when="never"`                       |
| A table too long to hydrate in one go                      | `as="tbody"` with a `view` per chunk |

A value of 4,096 characters or less stays in the page, so an island around it costs almost nothing. It also isn't a hydration boundary unless you add `defer`, so don't expect a small part to delay its hydration.

## 7. Keep per-visitor data out of public URLs

Parts are served from public, immutable URLs. Anything that differs per visitor needs `private: true`. See [Private data](../README.md#private-data). Turn on the ESLint rules so that this is caught as you write:

```js
import islands from "svelte-islands/eslint";

export default [islands.configs.recommended];
```

## 8. Share parts between servers

If you run more than one process, or your hosting restarts processes often, pass `handle()` a store. Without one, a process that doesn't have a part reruns the page that made it. See [Stores](../README.md#stores).

## 9. Keep it from growing back

Add `svelte-islands check` to CI, and render the overlay in development to see every island's state, data size, and timings, along with any skeleton that was off by more than 16 pixels:

```svelte
<script lang="ts">
  import { dev } from "$app/env";
  import Devtools from "svelte-islands/devtools";
</script>

{#if dev}
  <Devtools />
{/if}
```

## What behaves differently

- **`await` in an island's children.** An island's server HTML renders synchronously, so its children can't use `await`. Load the data into the part instead. See [Svelte's async mode](../README.md#sveltes-async-mode).
- **Links to anchors.** A deferred island's HTML isn't in the page yet. Only its headings with ids stay in the page, in its outline, so a link to any other id inside it finds nothing. Put the id on an element outside the island.
- **Components in a table.** An island's wrapper is a `div`, which the browser moves out of a table. Use `as="tbody"`.
- **Tests that read HTML.** A deferred island's content isn't in the first response, so a test that greps the page for it needs a browser, or a request for the part.
