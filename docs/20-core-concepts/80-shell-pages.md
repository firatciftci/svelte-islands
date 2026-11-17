---
title: Shell pages
description: A page with csr = false runs only its islands in the browser, with no SvelteKit client. Covers what an island gets from the page, which contexts cross over, what can't cross, navigation, and speculation.
---

A page with `export const csr = false` has no SvelteKit client. Nothing in the browser routes, hydrates the page, or keeps its data. Only the page's islands boot, each one on its own. The page is light to send, but its islands get less from it than they would on a SvelteKit page, and this is what they get.

```ts
/// file: src/routes/shell/+page.server.ts
import { part } from "svelte-islands/server";
import { getProducts } from "#lib/server/catalog.js";

export const csr = false;

export const load = async () => ({
  products: part("shell.products", await getProducts()),
});
```

```svelte
<!--- file: src/routes/shell/+page.svelte --->
<script>
  import { Island } from "svelte-islands";

  const { data } = $props();
  let count = $state(0);
</script>

<Island part={data.products}>
  {#snippet children(products)}
    <button onclick={() => count++}>
      {products.length} products, pressed {count} times
    </button>
  {/snippet}
</Island>
```

Shell pages need the [Vite plugin](70-vite-plugin.md). The plugin gives each island code that the boot can load. Without it, the page sends no boot at all, and its islands stay as server HTML.

## What an island gets

An island's value comes from its part, the same as on any page.

For the page values it reads, the server takes a snapshot when it renders the page and sends that snapshot with the page. The page doesn't run again, so those values never change on the server's side. Each island gets its own copy of that snapshot, objects included, so a change one island makes stays in that island. Two islands that read `count` each start from the same number, and pressing a button in one doesn't move the other.

## Contexts that cross

A context reaches an island only when its key can be named again in the browser. That means a string, a `Symbol.for()` symbol, or a key made with `context()` from svelte-islands. Use `context()` for a key an island needs:

```ts
/// file: src/lib/theme.ts
import { context } from "svelte-islands";

export const [getTheme, setTheme] = context<"light" | "dark">("theme");
```

The page calls `setTheme("dark")` in its script, and a component inside the island calls `getTheme()` when it initializes.

A context doesn't cross when its key is a `Symbol()` that isn't registered with `Symbol.for()`, or when its value holds a function or can't be serialized. In development, a warning names the island and the contexts it lost. In production, the context is dropped without a message.

## What can't cross

Functions can't cross. A page value that holds a function can't reach an island, because the browser has no copy of the function. The wrong way, with a helper defined in the page:

```svelte
<script>
  import { Island } from "svelte-islands";

  const { data } = $props();

  function shout(text) {
    return text.toUpperCase();
  }
</script>

<Island part={data.rows}>
  {#snippet children(rows)}
    <p>{shout(rows[0].name)}</p>
  {/snippet}
</Island>
```

In development, the page fails with this message:

```
svelte-islands: the island for part("shell.function") reads `shout` from the page, and it holds a function. On a page with csr = false, an island gets a copy of each page value it reads, so `shout` can't reach it. Define it in a module the island imports, or move it inside the island's snippet.
```

Move the function into a module the island imports, so the island's code has its own copy:

```ts
/// file: src/lib/text.ts
export function shout(text: string) {
  return text.toUpperCase();
}
```

Other values the serializer can't handle fail the same way, with the message saying the value "can't be serialized". In production, the error is logged with `console.error`, and the island is left out. Its server HTML stays where it is, without hydrating, and the page and its other islands still work.

SvelteKit's client modules don't run on a shell page. `$app/state`, for example, holds placeholder values, such as `url`, because nothing fills it in. Pass what an island needs through its part, or as a page value.

The boot imports `src/hooks.ts` when that file exists, so the transport codecs you register with `islands({ codecs })` decode the page's payload in the browser.

## Navigation and speculation

Links from a shell page are document navigations. The browser loads the next page from scratch, because no router intercepts the click. To make that faster, pass `speculation` and `viewTransitions` to `handle`:

```ts
/// file: src/hooks.server.ts
import { handle as islands } from "svelte-islands/server";

export const handle = islands({
  speculation: "prefetch",
  viewTransitions: true,
});
```

`speculation` adds a Speculation Rules script to each shell page. With `"prefetch"`, the browser fetches a same-origin page when a link is hovered. With `"prerender"`, it renders the page in the background instead. The rule covers every link on the site, except links with `download`, links with `rel~='external'`, and links with `data-sveltekit-preload-data="false"`. Pages with SvelteKit's client get no rule, because SvelteKit preloads links itself. A prerendered page costs the browser more than a prefetched one, and a visitor who hovers a link and never clicks still pays for it.

`viewTransitions: true` adds a style rule, `@view-transition { navigation: auto }`, to every page the handle renders, SvelteKit pages included. Where the browser supports cross-document View Transitions, it animates from one page to the next.

The island gets only the page values its snippet reads, the contexts above, and its part. SvelteKit's own request context, which holds the page's `data`, stays on the server, so a plain value that `load` returns doesn't end up in the HTML if it isn't a part and no island reads it.

For content that depends on the visitor, on a page you'd like to cache, see [Fresh islands](90-fresh-islands.md).
