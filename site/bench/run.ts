import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { cpus } from "node:os";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

declare global {
  interface Window {
    longTasks: Array<number>;
  }
}

const RUNS = 7;
const CPU_SLOWDOWN = 4;
const LATENCY = 150;
const DOWNLOAD = (1.6 * 1024 * 1024) / 8;
const UPLOAD = (750 * 1024) / 8;
const SETTLE = 1500;

const BUILD = new URL("../build/", import.meta.url).pathname;
const REPO = new URL("../../", import.meta.url);
const RESULTS = /<!-- results -->[\s\S]*<!-- \/results -->/u;

const TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

const COMPRESSED = new Set([".css", ".html", ".js", ".json", ".svg", ".txt"]);

type Served = { type: string; body: Buffer; isZipped: boolean };
type Name = "plain" | "islands";
type Key =
  | "html"
  | "total"
  | "paint"
  | "tasks"
  | "blocking"
  | "main"
  | "nodes"
  | "firstSort"
  | "placesSort"
  | "secondSort"
  | "totalAfter";
type Visit = Record<Key, number>;

const files = new Map<string, Served | null>();

async function fileAt(pathname: string) {
  const known = files.get(pathname);
  if (known !== undefined) {
    return known;
  }
  const safe = normalize(decodeURIComponent(pathname)).replace(
    /^(?:\.\.[/\\])+/u,
    "",
  );
  let found: Served | null = null;
  for (const candidate of [safe, `${safe}.html`, join(safe, "index.html")]) {
    try {
      const raw = await readFile(join(BUILD, candidate));
      const extension = extname(candidate);
      const isZipped = COMPRESSED.has(extension);
      found = {
        type: TYPES[extension] ?? "application/octet-stream",
        body: isZipped ? gzipSync(raw) : raw,
        isZipped,
      };
      break;
    } catch {
      continue;
    }
  }
  files.set(pathname, found);
  return found;
}

function serve() {
  const server = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    void fileAt(pathname).then((found) => {
      if (found == null) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": found.type,
        ...(found.isZipped ? { "content-encoding": "gzip" } : {}),
      });
      response.end(found.body);
    });
  });
  return new Promise<{ origin: string; close: () => void }>((done) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address != null ? address.port : 0;
      done({ origin: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

async function timedSort(page: Page, section: string, column: string) {
  const button = page
    .locator(`[data-demo="${section}"] .wards th`)
    .getByRole("button", { name: column, exact: true });
  await button.waitFor();
  await button.scrollIntoViewIfNeeded();
  const timing = page.evaluate(
    ({ section, column }) =>
      new Promise<number>((done) => {
        let start = 0;
        addEventListener(
          "pointerdown",
          () => {
            start = performance.now();
          },
          { capture: true, once: true },
        );
        const watcher = new MutationObserver(() => {
          const headers = document.querySelectorAll(
            `[data-demo="${section}"] th[aria-sort]`,
          );
          for (const header of headers) {
            if (header.textContent.trim() === column) {
              watcher.disconnect();
              requestAnimationFrame(() => {
                setTimeout(() => done(performance.now() - start));
              });
              return;
            }
          }
        });
        watcher.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["aria-sort"],
        });
      }),
    { section, column },
  );
  await button.click();
  return timing;
}

function downloaded(page: Page) {
  return page.evaluate(() => {
    const [document] = performance.getEntriesByType("navigation");
    const html =
      document instanceof PerformanceNavigationTiming
        ? document.encodedBodySize
        : 0;
    let total = html;
    for (const entry of performance.getEntriesByType("resource")) {
      if (entry instanceof PerformanceResourceTiming) {
        total += entry.encodedBodySize;
      }
    }
    return { html, total };
  });
}

async function visit(browser: Browser, url: string): Promise<Visit> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");
  await session.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: LATENCY,
    downloadThroughput: DOWNLOAD,
    uploadThroughput: UPLOAD,
  });
  await page.addInitScript(() => {
    window.longTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.longTasks.push(entry.duration);
      }
    }).observe({ type: "longtask", buffered: true });
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(SETTLE);

  const { html, total } = await downloaded(page);
  const { paint, durations } = await page.evaluate(() => ({
    paint:
      performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0,
    durations: window.longTasks,
  }));
  let blocking = 0;
  for (const duration of durations) {
    blocking += duration - 50;
  }
  const { metrics } = await session.send("Performance.getMetrics");
  const metric = (name: string) =>
    metrics.find((entry) => entry.name === name)?.value ?? 0;

  const firstSort = await timedSort(page, "districts", "Beacon");
  await page.locator('[data-demo="places"]').scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(SETTLE);
  const placesSort = await timedSort(page, "places", "Beacon");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(SETTLE);
  const secondSort = await timedSort(page, "places", "Harbor");
  const { total: totalAfter } = await downloaded(page);

  await context.close();
  return {
    html,
    total,
    paint,
    tasks: durations.length,
    blocking,
    main: metric("TaskDuration") * 1000,
    nodes: metric("Nodes"),
    firstSort,
    placesSort,
    secondSort,
    totalAfter,
  };
}

function median(values: Array<number>) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function eachKey<T>(make: (key: Key) => T): Record<Key, T> {
  return {
    html: make("html"),
    total: make("total"),
    paint: make("paint"),
    tasks: make("tasks"),
    blocking: make("blocking"),
    main: make("main"),
    nodes: make("nodes"),
    firstSort: make("firstSort"),
    placesSort: make("placesSort"),
    secondSort: make("secondSort"),
    totalAfter: make("totalAfter"),
  };
}

function summarize(visits: Array<Visit>) {
  const valuesOf = (key: Key) => visits.map((one) => one[key]);
  return {
    medians: eachKey((key) => Math.round(median(valuesOf(key)))),
    ranges: eachKey((key): [number, number] => [
      Math.round(Math.min(...valuesOf(key))),
      Math.round(Math.max(...valuesOf(key))),
    ]),
  };
}

async function versionOf(name: string) {
  const text = await readFile(
    new URL(`node_modules/${name}/package.json`, REPO),
    "utf8",
  );
  const manifest: unknown = JSON.parse(text);
  return typeof manifest === "object" &&
    manifest != null &&
    "version" in manifest
    ? String(manifest.version)
    : "unknown";
}

const number = (value: number) => value.toLocaleString("en-US");
const kilobytes = (value: number) => `${number(Math.round(value / 1024))} KB`;

function timed([low, high]: [number, number], value: number) {
  return `${number(value)} ms (${number(low)} to ${number(high)})`;
}

function tableOf(
  results: Record<Name, ReturnType<typeof summarize>>,
  note: string,
) {
  const { plain, islands } = results;
  const size = (label: string, key: Key) =>
    `| ${label} | ${kilobytes(plain.medians[key])} | ${kilobytes(islands.medians[key])} |`;
  const count = (label: string, key: Key) =>
    `| ${label} | ${number(plain.medians[key])} | ${number(islands.medians[key])} |`;
  const time = (label: string, key: Key) =>
    `| ${label} | ${timed(plain.ranges[key], plain.medians[key])} | ${timed(islands.ranges[key], islands.medians[key])} |`;
  return [
    "<!-- results -->",
    "",
    "| | Plain SvelteKit | With islands |",
    "| --- | ---: | ---: |",
    size("HTML", "html"),
    size("Total downloaded by the end of the load", "total"),
    size("Total downloaded after using both tables", "totalAfter"),
    time("First paint", "paint"),
    count("Long tasks", "tasks"),
    time("Blocking time", "blocking"),
    time("Main thread time", "main"),
    count("DOM nodes", "nodes"),
    time("First sort of the districts", "firstSort"),
    time("First sort of the polling places", "placesSort"),
    time("Second sort of the polling places", "secondSort"),
    "",
    note,
    "",
    "<!-- /results -->",
  ].join("\n");
}

const { origin, close } = await serve();
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
});
const paths: Record<Name, string> = {
  plain: "/demo/plain",
  islands: "/demo/islands",
};
const visits: Record<Name, Array<Visit>> = { plain: [], islands: [] };

for (let run = 0; run < RUNS; run += 1) {
  const order: Array<Name> =
    run % 2 === 0 ? ["plain", "islands"] : ["islands", "plain"];
  for (const name of order) {
    const result = await visit(browser, `${origin}${paths[name]}`);
    visits[name].push(result);
    console.log(run + 1, name, JSON.stringify(result));
  }
}

const major = browser.version().split(".")[0] ?? "";
await browser.close();
close();

const results = {
  plain: summarize(visits.plain),
  islands: summarize(visits.islands),
};
const date = new Date().toLocaleDateString("en-US", { dateStyle: "long" });
const model = cpus()[0]?.model.trim() ?? "an unknown CPU";
const machine = `Chromium ${major} on ${model}`;
const versions = {
  svelte: await versionOf("svelte"),
  kit: await versionOf("@sveltejs/kit"),
  node: process.versions.node,
};

await writeFile(
  new URL("docs/benchmark.json", REPO),
  `${JSON.stringify(
    {
      date,
      machine,
      runs: RUNS,
      versions,
      plain: results.plain.medians,
      islands: results.islands.medians,
      ranges: { plain: results.plain.ranges, islands: results.islands.ranges },
    },
    null,
    2,
  )}\n`,
);

const pageUrl = new URL("docs/70-appendix/60-benchmark.md", REPO);
const pageText = await readFile(pageUrl, "utf8");
if (!RESULTS.test(pageText)) {
  throw new Error("The benchmark page has no results block.");
}
const note = `Recorded on ${date} with ${machine}, using Svelte ${versions.svelte} and SvelteKit ${versions.kit}. Each number is the median of ${RUNS} runs, and the parentheses show the lowest and highest run.`;
await writeFile(pageUrl, pageText.replace(RESULTS, tableOf(results, note)));
console.log(JSON.stringify(results.plain.medians));
console.log(JSON.stringify(results.islands.medians));
