# svelte-islands

Islands for SvelteKit: content-addressed page data, server HTML adopted without hydration, and skeletons learned from your own markup.

```svelte
<Island part={data.products} hydrate="visible">
  {#snippet children(products)}
    <ProductTable {products} />
  {/snippet}
</Island>
```

The table renders on the server, so its HTML is in the page from the start. But the browser will not download `data.products`, or hydrate the table, until the table comes into view.

A SvelteKit page sends your `load` data twice: once as HTML, and once as serialized data so that the page can hydrate. For a page with a long table, map, or chart, the serialized copy can run to several megabytes, and the browser has to parse all of it before anything responds to a click.

svelte-islands takes that copy out of the page. Each value is stored under a hash of its contents at its own URL, so browsers and CDNs can keep it forever. While it's on its way, the island shows a skeleton that the library learned from what the island rendered last time.

## Beyond the data

The data is where most of the weight is, but 1.0 also limits the other costs of an island:

- with the optional [Vite plugin](docs/20-core-concepts/70-vite-plugin.md), each island's code moves into its own chunk, which loads together with its data
- a page with `export const csr = false` still gets working islands, and only they boot, with no SvelteKit client at all ([shell pages](docs/20-core-concepts/80-shell-pages.md))
- `render="fresh"` fills in what's different for each visitor (a name, a basket) on a page you cache for everyone, with one private request ([fresh islands](docs/20-core-concepts/90-fresh-islands.md))

## When it won't help

A page that is already small has nothing to gain, because a value of 4,096 characters or less stays in the page.

Islands also make the work happen later, and often never. They do not make it smaller, so a component with 10,000 elements takes just as long to hydrate when someone finally clicks on it. There are [separate tools](https://firatciftci.github.io/svelte-islands/docs/long-content/long-lists) for that.

## Getting started

You'll need SvelteKit 3 and Svelte 5.57 or later. Install the package, then run `init`, which makes the edits that set up a SvelteKit app:

```sh
npm install svelte-islands
npx svelte-islands init
```

`init` registers the transport, adds the server handle, imports the stylesheet, and adds the optional [Vite plugin](docs/20-core-concepts/70-vite-plugin.md), which gives each island its own chunk of code. [Setup](docs/10-getting-started/20-setup.md) shows each of those edits, in case you'd rather make them by hand.

Nothing on your pages changes until you make your first island. Wrap a heavy value in your server `load` function...

```ts
import { part } from "svelte-islands/server";

export async function load() {
  return { products: part("catalog.products", await getProducts()) };
}
```

...and render it with `Island`, as in the example at the top.

## Documentation

The [docs](https://firatciftci.github.io/svelte-islands/) have live demos, a [tutorial](https://firatciftci.github.io/svelte-islands/docs/getting-started/tutorial) that builds a product page step by step, and [worked examples](https://firatciftci.github.io/svelte-islands/docs/examples/comments) that go from a comment thread to running at scale. You can read the same pages [in this repository](docs). If you already have a page you want to move, start with [Moving a page to islands](docs/70-appendix/10-migrating.md).

## Status

svelte-islands 1.0 is the first stable release. It was built for [electionsarchive.com](https://electionsarchive.com), where a single page can hold tens of thousands of rows, but nothing in it is specific to that site.

## Credits

Several features follow [Mochi](https://github.com/khromov/mochi) by Stanislav Khromov and [Astro](https://astro.build), and the [credits](docs/70-appendix/80-credits.md) list which ones.

## License

[MIT](LICENSE)
