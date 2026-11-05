# svelte-islands

Islands for SvelteKit: content-addressed page data, server HTML adopted without hydration, and skeletons learned from your own markup.

```svelte
<Island part={data.rows} when="visible">
  {#snippet children(rows)}
    <ResultsTable {rows} />
  {/snippet}
</Island>
```

The table renders on the server, so its HTML is in the page from the start. But the browser will not download `data.rows`, or hydrate the table, until the table comes into view.

A SvelteKit page sends your `load` data twice: once as HTML, and once as serialized data so that the page can hydrate. For a page with a long table, map, or chart, the serialized copy can run to several megabytes, and the browser has to parse all of it before anything responds to a click.

svelte-islands takes that copy out of the page. Each value is stored under a hash of its contents at its own URL, which means browsers and CDNs can keep it forever. While it's on its way, the island shows a skeleton that the library learned from what the island rendered last time.

## When it won't help

A page that is already small has nothing to gain, because a value of 4,096 characters or less stays in the page.

Islands also make the work happen later, and often never. They do not make it smaller, so a component with 10,000 elements takes just as long to hydrate when someone finally clicks on it. There are [separate tools](https://firatciftci.github.io/svelte-islands/docs/long-content/long-lists) for that.

## Getting started

You'll need SvelteKit 3 and Svelte 5.57 or later:

```sh
npm install svelte-islands
```

Register the transport in `src/hooks.ts`...

```ts
import { islands } from "svelte-islands";

export const transport = islands();
```

...add the handle to `src/hooks.server.ts`...

```ts
import { handle as islands } from "svelte-islands/server";

export const handle = islands();
```

...and import the styles once in your root layout:

```ts
import "svelte-islands/styles.css";
```

Nothing on your pages changes until you make your first island. Wrap a heavy value in your server `load` function...

```ts
import { part } from "svelte-islands/server";

export async function load() {
  return { rows: part("results.rows", await get_rows()) };
}
```

...and render it with `Island`, as in the example at the top.

## Documentation

The [docs](https://firatciftci.github.io/svelte-islands/) have a live demo, and you can read the same pages [in this repository](docs). If you already have a page you want to move, start with [Moving a page to islands](docs/70-appendix/10-migrating.md).

## Status

svelte-islands has not reached 1.0, so you should expect the odd breaking change until it does. It was built for [electionsarchive.com](https://electionsarchive.com), where a single page can hold tens of thousands of rows.

## Credits

Several features follow [Mochi](https://github.com/khromov/mochi) by Stanislav Khromov and [Astro](https://astro.build), and the [credits](docs/70-appendix/80-credits.md) list which ones.

## License

[MIT](LICENSE)
