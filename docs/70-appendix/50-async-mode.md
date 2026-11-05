---
title: Svelte's async mode
---

The library works with async mode turned on, whether or not your components use `await`, and CI runs the browser tests that way.

There's one limit. An island's server HTML has to render synchronously, so an island whose children use `await` can't be part of it:

```svelte
<Island part={data.rows}>
  {#snippet children(rows)}
    <!-- this island can't be in the server HTML -->
    <ResultsTable {rows} parties={await get_parties()} />
  {/snippet}
</Island>
```

That island shows a skeleton and renders in the browser when it comes into view, and in dev the library logs a warning naming the part.

To keep the island in the server HTML, load the data into its part:

```ts
/// file: src/routes/results/+page.server.ts
export async function load() {
  const [rows, parties] = await Promise.all([get_rows(), get_parties()]);

  return { results: part("results", { rows, parties }) };
}
```
