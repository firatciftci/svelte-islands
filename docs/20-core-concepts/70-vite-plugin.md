---
title: The Vite plugin
description: The islands() plugin from svelte-islands/vite gives each island its own chunk, so a page downloads only the code its islands need. Covers setup, what it changes, when it leaves a snippet in the page, and how to check it worked.
---

An island's code should load when the island does, not with the rest of the page. The Vite plugin makes that happen. It moves the children snippet of each `<Island>` into a module of its own, so the browser downloads that code only when the island needs it.

Add it next to `sveltekit()` in your Vite config:

```ts
/// file: vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { islands } from "svelte-islands/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [sveltekit(), islands()] });
```

Without the plugin, the code for every island is part of the page's own JavaScript, so a visitor downloads all of it even when most of the islands never wake. With the plugin, the page's chunk holds only what the page itself needs.

## What the plugin changes

In the browser build, the plugin does three things to each island:

- It moves the snippet into a module of its own, along with the imports that only the snippet uses. An import the rest of the page still uses stays where it is.
- It passes the page values the snippet reads through a `scope` prop, as getters, and as a setter for each value the snippet writes to. The island reads the page's current value, not a copy made when the page loaded.
- It gives the island a loader for its code, which loads alongside the island's part.

A `{const}` block works in either of two places. One inside the snippet moves with it, and one around the island, such as inside an `{#each}` block, reaches the snippet through `scope`.

The server build moves nothing. It renders each snippet as before and adds the id of the island's module to its HTML, so the browser can find the code, and the markup it hydrates matches what the server rendered.

## Dev and build

In `vite dev`, the same split happens, and Vite transforms each island's module the first time the browser asks for it. In a build, each island's module becomes a chunk of its own, which the browser fetches when the island needs it.

## When a snippet stays in the page

The plugin leaves an island in the page when it can't move the island's snippet safely. The island still works, but its code stays in the page's chunk. The plugin logs a warning for each one, with the file, the line, and the reason:

```
src/routes/+page.svelte:5: the island stays in the page, because its <p> matches a selector in the page's scoped styles; move the markup into a component, or make the selector :global
```

These are the reasons it gives:

- the children aren't a snippet the plugin can find, such as `children={pick()}`
- the snippet uses `<slot>`, `<svelte:self>`, `let:`, `$$props`, `$$restProps`, or `$$slots`
- the snippet uses `{@debug}` on one of its values
- an element in the snippet could match a selector in the page's scoped styles
- a name in the snippet means something else where the island sits, such as a value that an `{#each}` around the island shadows

Scoped styles deserve a closer look. Svelte gives an element the page's scope class when one of the page's selectors could match it, and a moved snippet is compiled on its own, without that class, so the rule would stop matching. Here the island stays in the page, because its `<p>` is styled by the page's `<style>` block:

```svelte
<Island part={data.notes}>
  {#snippet children(notes)}
    <p>{notes.length} notes</p>
  {/snippet}
</Island>

<style>
  p {
    color: gray;
  }
</style>
```

The plugin checks each element's tag, its classes, its id, and its attributes against every scoped selector, including the ones inside `:has()`, `:is()`, and `:not()`. When it can't tell (a `class` built from an expression, a spread, or `<svelte:element>`), it assumes the element could match. A page rule that matches nothing in the snippet, such as `.sidebar` next to an island with no `sidebar` class, doesn't keep it in the page, and neither do `:global` rules or the styles of components the snippet renders.

Moving the markup into a component fixes it, because the component carries its own styles. Making the selector `:global` works too, if the rule is meant to reach the island.

## Islands that never hydrate

When an island has no `hydrate` prop and renders on the server (`render` is absent or `"server"`), the plugin checks whether its snippet can ever change. If it can't, the plugin gives the island `hydrate="never"`, so the browser downloads neither its code nor its data on the first load:

```svelte
<Island part={data.posts}>
  {#snippet children(posts)}
    <ul>
      {#each posts as post (post.slug)}
        <li><a href="/blog/{post.slug}">{post.title}</a></li>
      {/each}
    </ul>
  {/snippet}
</Island>
```

The snippet's own value is fine to read, because a new value has a new hash, and the island renders again when the hash changes. So are constants from the page's script (`const LABEL = "Posts"`, or `const format = new Intl.NumberFormat()`) and functions imported from plain modules.

An island keeps hydrating when its snippet:

- reads a value that can change: `$state`, `$derived`, props such as `data`, a `let`, a function declared in the page, a store, or a value from an `{#each}` around the island
- imports from `$app/*`, `svelte`, `svelte-islands`, or a `.svelte`, `.svelte.js`, or `.svelte.ts` file (components and shared state included)
- reads `Date`, `Math`, `crypto`, `performance`, `window`, `document`, `navigator`, `localStorage`, `sessionStorage`, or `location`
- has an event handler (`onclick` and the like), a binding, an action, an attachment, a transition, or an animation
- uses `{#await}`, `{@debug}`, `<svelte:boundary>`, `<svelte:element>` with a `this` that can change, or another special element
- renders a component

Plain forms, links, `<details>`, and `<dialog>` with `commandfor` buttons all work without Svelte, so they don't keep an island hydrating.

The plugin reads only the snippet, not the modules it imports. A function from a plain `.ts` or `.js` module is trusted to depend only on its arguments, so an island the plugin marked as never hydrating will not update when a helper reads shared state from a `.svelte.ts` module. Set `hydrate` on that island so that you control its hydration.

In `vite dev`, each island the plugin checked carries a `data-island-why` attribute: `inferred` when it never hydrates, or the first reason it found otherwise. [`inspect`](../50-tooling/05-init-and-inspect.md) and the [overlay](../50-tooling/30-overlay.md) show it too. To choose for yourself, set `hydrate`, and the plugin leaves the island alone.

The inference covers the first load only. After a client-side navigation, there's no server HTML to adopt, so the island renders in the browser from its snippet, and downloads its code to do it.

## Bundle strategy

The plugin needs SvelteKit to split code, so keep `kit.output.bundleStrategy` at its default, `"split"`. With `"single"` or `"inline"`, SvelteKit turns code splitting off, and there is no separate chunk for an island to load. The plugin then warns once per build, if the app has islands, and it stops emitting the island boot. Islands on a page with `csr = false` stay as server HTML and never hydrate. Islands on other pages keep their code in the one bundle.

## Checking that it worked

Two places show whether an island has a chunk of its own:

- `svelte-islands inspect` reads your running app and prints `code in its own chunk` for each island the plugin split, and `code in the page` for the rest. See [Init and inspect](../50-tooling/05-init-and-inspect.md).
- In development, the overlay's Code column shows the size of each island's chunk as the browser downloaded it. See the [overlay](../50-tooling/30-overlay.md). The cell can be blank when the browser doesn't report a size for the chunk, for example when the chunk came from the cache.

Pages with `csr = false` depend on the plugin, since it's what gives their islands code the browser can boot. See [Shell pages](80-shell-pages.md).
