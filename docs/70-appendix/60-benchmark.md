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

The islands page is compared against three plain SvelteKit pages, because "plain" can mean an app nobody has tuned or one somebody has:

- [untuned](https://firatciftci.github.io/svelte-islands/demo/plain), which renders every row of both tables
- [tuned](https://firatciftci.github.io/svelte-islands/demo/plain-tuned), which renders the first 100 berths and has a "Show all berths" button for the rest
- [lazy](https://firatciftci.github.io/svelte-islands/demo/plain-lazy), which leaves the berths out of the page and fetches them from a prerendered `+server.ts` route once the table comes within 320 px of the viewport — the same margin the islands page uses, so this is the fair comparison for a deferred island

Each visit uses a new browser context, so nothing is cached, and a small local server sends the built site with gzip. The pages take turns going first, because the machine may be busier at one moment than another.

Chromium runs under four conditions:

- slow 4G, the settings Lighthouse uses for its mobile test: 4x CPU slowdown, 150 ms of latency, 1.6 Mbps down, and 750 Kbps up
- slow 3G: 4x CPU slowdown, 400 ms of latency, and 500 Kbps each way
- unthrottled
- a 390 by 844 phone viewport with touch, on slow 4G

Firefox and WebKit run unthrottled only, since the throttling goes through the DevTools protocol, which only Chromium has. The desktop window is 1280 by 800.

Every page, condition, and browser gets 15 visits in each of two modes. A _cold_ visit waits for the `load` event and then sorts as soon as each header button exists, which is roughly what an impatient visitor does. A _settled_ visit waits for the network to go quiet, and then another 1.5 seconds, before each step. Either way, a visit goes like this:

- load the page and read the numbers for the load
- sort the harbors by Departures
- scroll to the berths
- sort the berths by Departures, then by Cargo (kt)
- wait 5 seconds and read the totals

A sort is timed twice. The _visible_ time runs from the press of the pointer to the first frame after the column header changes, in every browser. The Event Timing number is the longest event the browser reports for that interaction, which only Chromium exposes. It ignores events under 16 ms, so those show as 0.

_Long-task time_ adds up the part of each long task beyond 50 ms, over the whole visit, so it includes the sorts. _Total blocking time_ counts the same thing from first contentful paint to the first sort, so it measures only the load. Lighthouse ends that window at time to interactive instead, but that needs 5 quiet seconds, and a cold visit doesn't wait that long (Lighthouse itself dropped time to interactive in version 10). That window leans toward islands, since an island puts off its work until someone reaches for it, and total blocking time never sees work that happens after the first sort. That work shows up in long-task time and in the sort timings, so read those as the fair comparison, and total blocking time as what the load alone costs. In cold mode the first sort comes right after the load, so the window is short for every page. Long tasks are Chromium only, too.

Chromium counts bytes from the network events it reports to DevTools, with the main document counted as HTML. Firefox and WebKit count them from Playwright's request sizes, which include the response headers, so compare bytes within a browser and not across browsers.

Each number is the median of its 15 visits, and the parentheses hold a 95% bootstrap interval (2,000 resamples, with a fixed seed so a rerun over the same data gives the same intervals). The difference tables subtract each baseline's median from the islands median, with an interval of their own. When a difference's interval includes 0, the two pages aren't measurably apart.

Each visit also writes a JSON file to `docs/benchmark-raw/`, with its numbers and the timings they came from (long tasks, requests, and first contentful paint), so you can recompute any of them. Chromium visits also record a trace, which is gzipped and published with the release rather than committed, since all 480 come to about 150 MB. `checksums.txt` lists the SHA-256 of every file, and `docs/benchmark.json` records the browser versions, the operating system, the CPU, the package versions, and the commit.

## Running it yourself

The script lives in `site/bench/run.ts`. It needs all three browsers, which Playwright can install...

```sh
pnpm exec playwright install chromium firefox webkit
pnpm run bench
```

...and it rewrites the tables on this page, along with `docs/benchmark.json`, which the home page reads. A full run takes 2 to 3 hours, and it's worth leaving the machine alone while it does.

The home page also has a button that runs the untuned and islands pages in your own browser. That version uses no slowdown and reports fewer numbers, but it's your machine and your connection.
