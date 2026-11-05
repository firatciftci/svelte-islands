---
title: Measuring real users
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

- `load` means the browser downloaded and decoded a part's data, and adds `bytes` and `duration`
- `markup` means the browser downloaded a deferred island's HTML, and adds `bytes` and `duration`
- `hydrate` means an island became interactive, and adds `when` (the strategy that woke it) and `duration`
- `reveal` means content replaced a skeleton, and adds `from` and `to` (the island's height in pixels before and after)
- `fail` means a part or deferred HTML could not be downloaded, and adds `message`

A large difference between `from` and `to` means the skeleton shifted your page.

The library measures heights only while a listener is attached, so an app that never calls `observe` pays nothing for it.
