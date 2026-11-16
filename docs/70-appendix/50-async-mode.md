---
title: Svelte's async mode
description: svelte-islands works with Svelte's async mode turned on. The one limit: an island's server HTML has to render without await.
---

The library works with async mode turned on, whether or not your components use `await`, and CI runs the browser tests that way.

There's one limit. An island's server HTML has to render synchronously, so an island whose children use `await` can't be part of it:

```svelte
<Island part={data.products}>
  {#snippet children(products)}
    <!-- this island can't be in the server HTML -->
    <ProductTable {products} categories={await getCategories()} />
  {/snippet}
</Island>
```

That island shows a skeleton and renders in the browser when it comes into view, and in dev the library logs a warning naming the part.

To keep the island in the server HTML, load the data into its part:

```ts
/// file: src/routes/products/+page.server.ts
export async function load() {
  const [products, categories] = await Promise.all([
    getProducts(),
    getCategories(),
  ]);

  return { catalog: part("catalog", { products, categories }) };
}
```
