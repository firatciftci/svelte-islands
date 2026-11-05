---
title: Budget check
---

A page gets heavy one small change at a time, and nobody notices until it's slow. `svelte-islands check` fetches your pages from a running server and fails if any of them is over its budget, so that you can catch this in CI or before a deploy:

```sh
npx svelte-islands check http://localhost:4173
```

The budget goes in `islands.budget.json`. Limits are in KiB, and a page can have its own:

```json
/// file: islands.budget.json
{
  "limits": { "raw": 400, "gzip": 60, "inline": 150 },
  "pages": { "/": {}, "/results": { "raw": 800 } }
}
```

- `raw` is the size of the HTML
- `gzip` is its compressed size
- `inline` is how much of it is inline script

The command prints a line per page, and says which limit a page went over:

```
/  raw 42 KiB of 400 KiB  gzip 9 KiB of 60 KiB  inline 12 KiB of 150 KiB
over budget: /results: raw 812 KiB is over 800 KiB
/results  raw 812 KiB of 800 KiB  gzip 41 KiB of 60 KiB  inline 88 KiB of 150 KiB
```

It asks for uncompressed HTML and applies gzip compression itself, so the numbers do not depend on your proxy.

## Exit codes

- 0 means every page is within budget
- 1 means a page is over budget, or could not be fetched
- 2 means a usage or configuration error

## Another budget file

If you keep more than one budget (for staging and production, say), `--config` points the command at another file:

```sh
npx svelte-islands check http://localhost:4173 --config budgets/staging.json
```
