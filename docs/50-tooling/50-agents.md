---
title: Coding agents
description: Give a coding agent the docs as llms.txt, and tools over MCP that inspect your pages, check budgets, size page data, and explain why an island hydrates.
---

A coding agent does better work with svelte-islands when it can read the docs and look at your pages the way you would. The library gives it both.

## The docs as text

The docs site publishes [`llms.txt`](https://firatciftci.github.io/svelte-islands/llms.txt), an index of every page, and [`llms-full.txt`](https://firatciftci.github.io/svelte-islands/llms-full.txt), every page in one file. Each page is also on its own at its URL plus `/llms.txt`. Point your agent at the index, or put the full file in its context.

## The MCP server

`svelte-islands mcp` starts an [MCP](https://modelcontextprotocol.io) server over stdio. In Claude Code, you can add it with:

```sh
claude mcp add svelte-islands -- npx svelte-islands mcp
```

Other agents take the same command in their MCP settings. Where they live depends on the agent (`.cursor/mcp.json` in Cursor, for example), but most use this shape:

```json
{
  "mcpServers": {
    "svelte-islands": { "command": "npx", "args": ["svelte-islands", "mcp"] }
  }
}
```

The tools read pages from your running app, so start the dev server or `vite preview` first, and give them full URLs:

- `inspect_page` lists a page's islands, the same way [`svelte-islands inspect --json`](05-init-and-inspect.md) does
- `check_budget` checks pages against your `islands.budget.json`, like [`svelte-islands check`](10-budget-check.md), and returns each page's sizes along with the limits it's over
- `advise_page_data` lists the page's `load` data by size and names the large values that should become parts, like the page data table in the [overlay](30-overlay.md#page-data)
- `explain_island` says why an island hydrates, or why it never does. It reads the reason the [Vite plugin](../20-core-concepts/70-vite-plugin.md) writes on each island. The plugin writes that reason only on the dev server, and only for islands without a `hydrate` prop

The server only reads. It never changes your files, and it doesn't add any dependencies.
