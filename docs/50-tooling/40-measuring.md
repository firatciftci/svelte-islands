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
  - `when`: the strategy that woke it, under the field's existing name, though the `Island` prop that chooses strategies is now `hydrate`
  - `duration`: how long hydration took, in milliseconds
  - `delay`: the time from the first press, focus, or touch on the island to when it became interactive, or `null` when nobody touched it first
  - `code`: the size of the island's own chunk in bytes, as the browser received it, or `null` when the Vite plugin didn't split the island out
  - `data`: the size of its part, in characters
  - `html`: the size of its HTML, in characters
  - `isPrefetched`: whether its part was prefetched
- `reveal` means content replaced a skeleton, and adds `from` and `to`, the island's height in pixels before and after
- `fail` means a part or deferred HTML could not be downloaded, and adds `message`

A large difference between `from` and `to` means the skeleton shifted your page.

The library measures heights only while a listener is attached, so an app that never calls `observe` pays nothing for it.
