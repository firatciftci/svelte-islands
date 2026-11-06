---
title: Benchmark
---

To find out what islands are worth, we built one page twice. Both versions show the same invented election, with 120 districts and 3,000 polling places in two sortable tables and a chart. The [plain version](https://firatciftci.github.io/svelte-islands/demo/plain) is ordinary SvelteKit, and the [islands version](https://firatciftci.github.io/svelte-islands/demo/islands) puts the tables and the chart in islands.

We chose a long page of data because that is what islands are for, so you should read these numbers as the favorable case.

<!-- results -->

|                                          |           Plain SvelteKit |              With islands |
| ---------------------------------------- | ------------------------: | ------------------------: |
| HTML                                     |                     99 KB |                      5 KB |
| Total downloaded by the end of the load  |                    250 KB |                    166 KB |
| Total downloaded after using both tables |                    250 KB |                    259 KB |
| First paint                              | 1,472 ms (1,140 to 1,532) |       784 ms (712 to 796) |
| Long tasks                               |                         2 |                         1 |
| Blocking time                            |   1,114 ms (727 to 1,247) |           45 ms (0 to 76) |
| Main thread time                         | 2,418 ms (1,796 to 2,801) |       598 ms (481 to 751) |
| DOM nodes                                |                    34,624 |                     2,088 |
| First sort of the districts              |          75 ms (48 to 84) |        150 ms (67 to 177) |
| First sort of the polling places         |       800 ms (661 to 929) | 1,336 ms (1,205 to 1,721) |
| Second sort of the polling places        |     851 ms (720 to 1,065) |       776 ms (558 to 872) |

Recorded on November 5, 2026 with Chromium 156 on Intel(R) Core(TM) Ultra 9 275HX, using Svelte 5.57.3 and SvelteKit 3.1.1. Each number is the median of 7 runs, and the parentheses show the lowest and highest run.

<!-- /results -->

## What the numbers show

The load is where islands help. The plain page sends every row as HTML and again as data, and it can't respond to anything until it has hydrated all of them. The islands page sends the HTML for the districts, leaves the polling places out until you scroll toward them, and hydrates neither table until you reach for it.

The first sort is where you pay for that. On the plain page the code is already running, so sorting only has to move the rows. On the islands page, the first sort of a table also hydrates it, and the first sort of the polling places has to download their data as well. Once a table has hydrated, it's as fast as the plain one, which is why the second sort is close.

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
- sort the districts by Beacon
- scroll to the polling places and wait again
- sort the polling places by Beacon, wait, and sort them by Harbor
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
