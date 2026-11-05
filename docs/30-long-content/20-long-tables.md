---
title: Long tables
---

A table with thousands of elements takes a long time to hydrate in one go, and tables have a further problem: an island's wrapper is a `div`, which can't sit between a `table` and its rows. If you try, the HTML parser moves it out of the table.

There are two ways to handle one, depending on where it sits on your page.

## Below the fold

If the table starts below the fold, you can defer the whole thing:

```svelte
<div style="--island-item: 2.75rem">
  <Island part={data.rows} defer when="visible">
    {#snippet children(rows)}
      <ResultsTable {rows} />
    {/snippet}
  </Island>
</div>
```

Your page then holds only a skeleton, and the rows arrive when someone scrolls close to the table. Note that the island goes around the whole `<table>` here, so the `div` is not a problem.

The skeleton keeps the first few rows and adds one spacer row for the rest, so the table holds about the right height while it waits. That's what `--island-item` is for — you should set it to the height of a row, so that the spacer matches.

This has the same trade-off as any [deferred island](../20-core-concepts/20-islands.md#deferred): the rows are not in the page's HTML, so anyone without JavaScript can't see them.

## Near the top

If the table is near the top of your page, or its HTML has to be in the page, you can split it into a `tbody` per chunk with `as="tbody"`:

```svelte
<table>
  <thead>...</thead>
  {#each ["0", "1", "2"] as chunk (chunk)}
    <Island part={data.rows} view={chunk} as="tbody" when="visible">
      {#snippet children(rows)}
        {#each rows.slice(Number(chunk) * 100, (Number(chunk) + 1) * 100) as row (row.id)}
          <tr><td>{row.name}</td></tr>
        {/each}
      {/snippet}
    </Island>
  {/each}
</table>
```

Each chunk hydrates on its own when it comes into view, and all the chunks share one part, so the data downloads once.

A table may hold any number of `tbody` elements, so to the browser this is still one table.

Since `as="tbody"` makes the island's wrapper part of the table, there's nowhere to put a skeleton. So it needs its server HTML in the page, and it throws an error if you combine it with `defer` or `ssr={false}`.

## What about `content-visibility`?

You might be tempted to use `content-visibility: auto` on your rows instead. Unfortunately it has no effect on table rows, because size containment does not apply to internal table boxes.

It does work on a `div`-based grid, and you can use it alongside an island there, though it only saves rendering work — the browser still has to parse the HTML and hydrate the elements.
