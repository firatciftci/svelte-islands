---
title: Benchmark
description: We built one data-heavy page twice, with plain SvelteKit and with islands. This covers HTML size, blocking time, measurement, and where islands don't help.
---

To find out what islands are worth, we built one page twice. Both versions show the same invented shipping data for Harrow Sound, with 120 harbors and 3,000 berths in two sortable tables and a chart. The [plain version](https://firatciftci.github.io/svelte-islands/demo/plain) is ordinary SvelteKit, and the [islands version](https://firatciftci.github.io/svelte-islands/demo/islands) puts the tables and the chart in islands.

We chose a long page of data because that is what islands are for, so you should read these numbers as the favorable case.

<!-- results -->

|                                          |     Plain SvelteKit |        With islands |
| ---------------------------------------- | ------------------: | ------------------: |
| HTML                                     |               99 KB |                5 KB |
| Total downloaded by the end of the load  |              250 KB |              170 KB |
| Total downloaded after using both tables |              250 KB |              263 KB |
| First paint                              | 856 ms (844 to 888) | 488 ms (484 to 500) |
| Long tasks                               |                   1 |                   0 |
| Blocking time                            | 214 ms (210 to 241) |       0 ms (0 to 0) |
| Main thread time                         | 799 ms (779 to 895) | 179 ms (173 to 208) |
| DOM nodes                                |              34,631 |               2,126 |
| First sort of the harbors                |    39 ms (37 to 49) |    41 ms (40 to 44) |
| First sort of the berths                 | 257 ms (233 to 278) | 263 ms (244 to 300) |
| Second sort of the berths                | 273 ms (263 to 302) | 275 ms (253 to 296) |

Recorded on November 18, 2026 with Chromium 156 on Apple M5 Pro, using Svelte 5.57.3 and SvelteKit 3.1.1. Each number is the median of 7 runs, and the parentheses show the lowest and highest run.

<!-- /results -->

## What the numbers show

The load is where islands help. The plain page sends every row as HTML and again as data, and it can't respond to anything until it has hydrated all of them. The islands page sends the HTML for the harbors, leaves the berths out until you scroll toward them, and hydrates neither table until you reach for it.

The first sort is where you'd expect to pay for that, since on the islands page it also hydrates the table. In practice it costs only a few milliseconds more than on the plain page, and the two ranges overlap. By the time you reach a table, the browser has already fetched its data and its code, at low priority while it was idle, so the sort doesn't wait for the network. That depends on the early fetch, though. On a slow connection, or with `Save-Data` on, nothing is fetched early, so the first sort of the berths, which have the most data on the page, would wait for the download.

## Where islands don't help

- a visitor who uses every table downloads about as much as they do on the plain page, or slightly more, because the HTML and the data arrive separately
- the library adds about 11 KB of compressed JavaScript to every page that uses it
- a small part doesn't become an island at all (see [small parts](../20-core-concepts/10-parts.md#small-parts-stay-in-the-page)), so a short page has nothing to gain
- once everything is hydrated, the page is doing the same work as the plain one

If people usually open your page to sort its only table, and their connections are slow, an island moves the cost from the load to the moment they care about, and you may prefer to keep that table out of an island or to [wake it early](../20-core-concepts/30-when-islands-wake.md).

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
