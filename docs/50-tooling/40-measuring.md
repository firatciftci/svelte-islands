---
title: Measuring real users
description: Send island timings from real visitors to your analytics with observe: when each part loads, how many bytes it took, and how long hydration ran.
---

`observe` calls your function with data on what each island does in the browser, so that you can send real timings to your analytics. Call it once in your root layout, in the browser only:

```ts
/// file: src/routes/+layout.ts
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

It returns a function that stops listening.

Each event has a `type`, plus the part's `name` and `hash`:

- `load` means the browser downloaded and decoded a part's data. It adds `bytes`, `duration`, and `isPrefetch`, which is true when the part was fetched early, at low priority, because its island came near the viewport.
- `markup` means the browser downloaded a deferred island's HTML, and adds `bytes` and `duration`.
- `hydrate` means an island became interactive, and adds the fields below.
  - `when`: the strategy that woke it (the name stays the same, though the `Island` prop that chooses strategies is now `hydrate`)
  - `duration`: how long hydration took, in milliseconds
  - `delay`: the time from the first press, focus, or touch on the island to when it became interactive, or `null` when nobody touched it first
  - `code`: the size of the island's own chunk in bytes, as the browser received it, or `null` when the Vite plugin didn't split the island out
  - `data`: the size of its part, in characters
  - `html`: the size of its HTML, in characters
  - `isPrefetched`: whether its part was prefetched
- `reveal` means content replaced a skeleton, and adds `from` and `to`, the island's height in pixels before and after
- `fail` means a part or deferred HTML could not be downloaded, and adds `message`
- `prefetch` arrives when the page is hidden or the reader moves to another page, and has no `name` or `hash` of its own. It adds `parts`, one entry for each part fetched early, with its `name`, its `hash`, and an `outcome`: `used` when an island read it after it arrived, `late` when an island needed it before it arrived, and `wasted` when no island read it
- `frame` means an island's hydration ran in a [long animation frame](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Long_animation_frame_timing), one over 50 milliseconds, and has no `name` or `hash` of its own. It adds `duration`, the frame's length; `blocking`, how long the frame kept the page from responding to input; and `islands`, the `name` and `hash` of each island that hydrated in it. A click that arrived before the island was ready replays in the same frame, so its cost is counted here too. Only Chromium browsers support the Long Animation Frames API, so other browsers never send this event

A large difference between `from` and `to` means the skeleton shifted your page.

The library measures heights only while a listener is attached, so an app that never calls `observe` pays nothing for it.

## Tracing on the server

If you turn on SvelteKit's [OpenTelemetry tracing](https://svelte.dev/docs/kit/observability), the library adds its own spans under SvelteKit's, so you can see where the server spent its time on parts:

- `svelte-islands.page` covers adding the library's tags to the page, with the number of islands and the bytes of parts sent inside the page and fetched separately
- `svelte-islands.part.serialize` covers turning one part into JSON, with the part's name and size
- `svelte-islands.rebuild` covers rendering a page again to recover a part the server no longer has, with the page, the queue length, and an `outcome`: `ran`, `cooling` when the page was rebuilt too recently, or `busy` when the queue was full
- `svelte-islands.fresh` covers a request for fresh islands, with the page, the queue length, and an `outcome`: `ran`, `barren` when the page recently had no fresh islands, or `busy`

The spans need `@opentelemetry/api`, which you already have installed if SvelteKit's tracing works. When tracing is off, the library never imports it.
