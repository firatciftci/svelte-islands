---
title: Errors and warnings
description: What each svelte-islands error and warning code means, why it happens, and how to fix it.
---

Every error and warning from svelte-islands starts with a code and ends with a link to that code's section below:

```
islands_part_after_cookies
part("account") was made during a request that read cookies. Parts are served from a public, immutable URL. If this value differs per visitor, pass { private: true }. If it doesn't, pass warnOnCookies: false to handle().
https://firatciftci.github.io/svelte-islands/docs/appendix/errors#islands_part_after_cookies
```

The codes don't change between versions, so you can search for them in your logs.

## `islands_private_in_public`

Thrown on the server when a private part is inside a public part. The public part's JSON would include the private value, and anyone with its URL could read it. Make the outer part private too, or return the private part next to it rather than inside it. See [private data](../60-best-practices/10-private-data.md).

## `islands_tbody_needs_server`

Thrown when an island with `as="tbody"` doesn't use `render="server"`. A `<tbody>` can only hold rows, so the island's rows have to be in the page's HTML from the start — a skeleton in their place would end up outside the table. Use `render="server"`, which [long tables](../30-long-content/20-long-tables.md) shows.

## `islands_part_after_cookies`

Logged in development when a request reads cookies and then makes a part without `private: true`. Public parts are stored and served to everyone, so a value that depends on the cookie would reach other visitors. Pass `{ private: true }` if the value differs per visitor. If it doesn't, pass `warnOnCookies: false` to `handle()`. See [private data](../60-best-practices/10-private-data.md).

## `islands_await_while_rendering`

Logged in development when an island's content uses `await` while the server renders it. The server renders islands synchronously, so the island is rendered in the browser instead, and the page's HTML doesn't include it. Load that data in `load` and put it in the part, so the island has it when it renders.

## `islands_shell_value`

An island on a page with `csr = false` reads a page value that can't be serialized, such as a function. An island on a [shell page](../20-core-concepts/80-shell-pages.md) gets a copy of each page value it reads, sent with the page as JSON. Define the value in a module the island imports, or move it inside the island's snippet. In development this is thrown, and in production it's logged, and the island stays as server HTML. See [what can't cross](../20-core-concepts/80-shell-pages.md#what-cant-cross).

## `islands_shell_context`

Logged in development when an island on a page with `csr = false` won't get one of its contexts. Only contexts whose keys are strings or `Symbol.for()` symbols, and whose values can be serialized, reach an island on a shell page. Make the key with `context()` from svelte-islands, as [contexts that cross](../20-core-concepts/80-shell-pages.md#contexts-that-cross) shows.

## `islands_csr_mismatch`

Logged in development when a route's `csr` export and its HTML disagree: the Vite plugin read `csr = false` from the route's files, but the page has SvelteKit's client script, or the other way around. Islands follow the `csr` export. This shouldn't happen, so if you see it, please [report it](https://github.com/firatciftci/svelte-islands/issues) with the route's `+page` and `+layout` files.

## `islands_fresh_failed`

Logged when the server can't render a page again for its [fresh islands](../20-core-concepts/90-fresh-islands.md), so they show the values the page was rendered with. Most often the page is prerendered, and the server can't render a prerendered page again. Render the page on the server and cache it with `cache-control` instead. See [fresh islands show the page's own values](20-troubleshooting.md#fresh-islands-show-the-pages-own-values).

## `islands_island_kept`

A build warning from the Vite plugin when it can't move an island's code into its own chunk, so that code stays in the page's bundle. The warning names the file, the line, and the reason. [The Vite plugin leaves an island in the page](20-troubleshooting.md#the-vite-plugin-leaves-an-island-in-the-page) lists each reason and its fix.

## `islands_no_code_splitting`

A build warning when the client build doesn't split code, so every island's code stays in the main bundle, and islands on pages with `csr = false` stay as server HTML. Use SvelteKit's default `output.bundleStrategy`, `"split"`. See [the build warns that islands stay as server HTML](20-troubleshooting.md#the-build-warns-that-islands-stay-as-server-html).

## `islands_missing_code`

Thrown in the browser, on a page with `csr = false`, when the island boot requests an island that has no code in the build. It usually means the page's HTML came from an older build than its scripts (a page cached across a deploy, for example), so reloading the page fixes it.

## `islands_missing_children`

Thrown in the browser when an island has no `children` snippet and no code from the Vite plugin, so there's nothing to hydrate it with. Give the `Island` a `children` snippet.

## `islands_part_failed`

Logged in the browser when a part's data couldn't be downloaded or decoded, followed by the error. The island can't hydrate without it. See [an island stays static and its controls don't respond](20-troubleshooting.md#an-island-stays-static-and-its-controls-dont-respond) for what to look for in the network panel.
