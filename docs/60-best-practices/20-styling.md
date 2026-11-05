---
title: Styling
---

Skeleton bars take their color from the island's text, so they usually look right without any help. To change them, set these custom properties:

```css
/// file: src/app.css
:root {
  --island-bone: oklch(0.9 0 0);
  --island-radius: 0.125rem;
  --island-pulse: 2s;
}
```

- `--island-bone` is the color of skeleton bars
- `--island-radius` is their corner radius (`0.25em` by default)
- `--island-pulse` is the length of the pulse animation (`1.4s` by default)
- `--island-surface` is the background of a region that has no learned skeleton yet (transparent by default)
- `--island-inset` is the padding of that region (0 by default)
- `--island-item` is the height of the spacer row for each table row a skeleton leaves out (`2em` by default)

The pulse stops when someone prefers reduced motion.

## The wrapper

An island's wrapper has `display: contents`, so its content sits directly in your grid or flex layout. This also means that the wrapper has no box of its own — padding, borders, and outlines on it have no effect.

If you need a box, put an element of your own around the island:

```svelte
<div class="card">
  <Island part={data.rows}>
    {#snippet children(rows)}
      <ResultsTable {rows} />
    {/snippet}
  </Island>
</div>
```

(With `as="tbody"` the wrapper is a real `tbody`, and has a box like any other.)

## Selecting islands

`class` puts a class on the wrapper, which you can use along with `data-island-state` to style what's inside. The state is `static`, `deferred`, `client`, or `live`, so you could fade a table's sort arrows until the table can respond:

```css
.results[data-island-state="static"] .arrow {
  opacity: 0.4;
}
```

After a client-side navigation there is no server HTML to adopt, so the attribute is not there at all.

While an island shows a skeleton and has no outline, its wrapper has `aria-busy="true"`.
