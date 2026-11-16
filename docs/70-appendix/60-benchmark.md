---
title: Benchmark
---

To find out what islands are worth, we built one page twice. Both versions show the same invented shipping data for Harrow Sound, with 120 harbors and 3,000 berths in two sortable tables and a chart. The [plain version](https://firatciftci.github.io/svelte-islands/demo/plain) is ordinary SvelteKit, and the [islands version](https://firatciftci.github.io/svelte-islands/demo/islands) puts the tables and the chart in islands.

We chose a long page of data because that is what islands are for, so you should read these numbers as the favorable case.

<!-- results -->

|                                          |     Plain SvelteKit |        With islands |
| ---------------------------------------- | ------------------: | ------------------: |
| HTML                                     |               99 KB |                5 KB |
| Total downloaded by the end of the load  |              250 KB |              167 KB |
| Total downloaded after using both tables |              250 KB |              259 KB |
| First paint                              | 860 ms (840 to 896) | 492 ms (492 to 504) |
| Long tasks                               |                   1 |                   0 |
| Blocking time                            | 203 ms (198 to 220) |       0 ms (0 to 0) |
| Main thread time                         | 760 ms (756 to 913) | 170 ms (164 to 183) |
| DOM nodes                                |              34,612 |               1,959 |
| First sort of the harbors                |    36 ms (33 to 42) |    39 ms (38 to 42) |
| First sort of the berths                 | 237 ms (229 to 247) | 717 ms (707 to 725) |
| Second sort of the berths                | 248 ms (237 to 294) | 245 ms (237 to 261) |

Recorded on November 16, 2026 with Chromium 156 on Apple M5 Pro, using Svelte 5.57.3 and SvelteKit 3.1.1. Each number is the median of 7 runs, and the parentheses show the lowest and highest run.

<!-- /results -->

## What the numbers show

The load is where islands help. The plain page sends every row as HTML and again as data, and it can't respond to anything until it has hydrated all of them. The islands page sends the HTML for the harbors, leaves the berths out until you scroll toward them, and hydrates neither table until you reach for it.

The first sort is where you pay for that. On the plain page the code is already running, so sorting only has to move the rows. On the islands page, the first sort of a table also hydrates it, and the first sort of the berths has to download their data as well. Once a table has hydrated, it's as fast as the plain one, which is why the second sort is close.

## Where islands don't help

- a visitor who uses every table downloads about as much as they do on the plain page, or slightly more, because the HTML and the data arrive separately
- the library adds about 11 KB of compressed JavaScript to every page that uses it
- a small part doesn't become an island at all (see [small parts](../20-core-concepts/10-parts.md#small-parts-stay-in-the-page)), so a short page has nothing to gain
- once everything is hydrated, the page is doing the same work as the plain one

If people usually open your page to sort its only table, an island moves the cost from the load to the moment they care about, and you may prefer to keep that table out of an island or to [wake it early](../20-core-concepts/30-when-islands-wake.md).

## How it's measured

Each visit uses a new browser context, so nothing is cached. The window is 1280 by 800, and the CPU and network are slowed to the settings that Lighthouse uses for its mobile test: 4x CPU slowdown, 150 ms of latency, 1.6 Mbps down, and 750 Kbps up. A small local server sends the built site with gzip. The two pages take turns going first, because the machine may be busier at one moment than another, and each page gets 7 visits.

A visit goes like this:

- load the page, wait for the network to go quiet, and wait another 1.5 seconds
- read the numbers for the load
- sort the harbors by Departures
- scroll to the berths and wait again
- sort the berths by Departures, wait, and sort them by Cargo (kt)
- read the total downloaded

A sort is timed from the press of the pointer to the first frame after the column header changes. _Blocking time_ adds up the part of each long task beyond 50 ms, up to the end of the load. _Main thread time_ is Chromium's own count of time spent on tasks, and _DOM nodes_ is its count of nodes in the page.

The machine was not otherwise idle, so the range beside each number matters as much as the number.

## Running it yourself

The script lives in `site/bench/run.ts`. It needs a copy of Chromium, which Playwright can install...

```sh
pnpm exec playwright install chromium
pnpm run bench
```

...and it rewrites the table on this page, along with `docs/benchmark.json`, which the home page reads.

The home page also has a button that runs both pages in your own browser. That version uses no slowdown and reports fewer numbers, but it's your machine and your connection.
