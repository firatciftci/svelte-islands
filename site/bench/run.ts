import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { cpus, release } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { chromium, firefox, webkit } from "@playwright/test";
import type {
  Browser,
  BrowserContext,
  BrowserType,
  CDPSession,
  Page,
} from "@playwright/test";

declare global {
  interface Window {
    bench: {
      longTasks: Array<[number, number]>;
      events: Array<{ start: number; duration: number; id: number }>;
    };
  }
}

const RUNS = 15;
const SEED = 20261119;
const RESAMPLES = 2000;
const SETTLE = 1500;
const TAIL = 5000;
const LONG_TASK = 50;
const ATTEMPTS = 3;
const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "loading",
  "blink.user_timing",
];

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BUILD = new URL("../build/", import.meta.url).pathname;
const RAW = join(ROOT, "docs", "benchmark-raw");
const SUMMARY = join(ROOT, "docs", "benchmark.json");
const PAGE = join(ROOT, "docs", "70-appendix", "60-benchmark.md");
const RESULTS = /<!-- results -->[\s\S]*<!-- \/results -->/u;

const COPY = {
  modeCold: "Cold start",
  modeSettled: "Settled",
  modeNote:
    "A cold start waits for the load event and sorts as soon as each header appears. Settled waits for the network to go quiet and then waits 1.5 seconds before each step.",
  variantIslands: "With islands",
  variantUntuned: "Plain, untuned",
  variantTuned: "Plain, tuned",
  variantLazy: "Plain, lazy",
  conditionSlow4g: "Slow 4G",
  conditionSlow3g: "Slow 3G",
  conditionUnthrottled: "Unthrottled",
  conditionMobile: "Mobile viewport, slow 4G",
  bytesCdp:
    "Bytes are counted from the network events that Chromium reports to DevTools.",
  bytesPlaywright:
    "Bytes are counted from Playwright's request sizes, because DevTools network events are only available in Chromium. Long tasks and Event Timing aren't available in this browser, so those cells show n/a.",
  cellsNote:
    "Each cell is the median of {runs} runs, with a 95% bootstrap interval in parentheses. The difference tables show the islands median minus the baseline median, with its own interval. n/a means the browser doesn't expose that measure.",
  recordedNote:
    "Recorded on {date} with {machine}, using Svelte {svelte} and SvelteKit {kit}, from commit {commit}.",
  differenceHeading: "Islands minus baseline",
  metricHeader: "Metric",
  metricHtml: "HTML",
  metricBytesLoad: "Downloaded by load",
  metricBytesEnd: "Downloaded by end of visit",
  metricFcp: "First contentful paint",
  metricNodes: "DOM nodes",
  metricTasks: "Long tasks",
  metricOverrun: "Long-task time above 50 ms",
  metricTbt: "Total blocking time",
  metricHarborVisible: "First harbor sort, visible",
  metricHarborEvent: "First harbor sort, Event Timing",
  metricBerthVisible: "First berth sort, visible",
  metricBerthEvent: "First berth sort, Event Timing",
  metricSecondVisible: "Second berth sort, visible",
  metricSecondEvent: "Second berth sort, Event Timing",
};

const MODES = ["cold", "settled"] as const;
const VARIANTS = ["islands", "untuned", "tuned", "lazy"] as const;
const PATHS: Record<Variant, string> = {
  islands: "/demo/islands",
  untuned: "/demo/plain",
  tuned: "/demo/plain-tuned",
  lazy: "/demo/plain-lazy",
};
const VARIANT_LABELS: Record<Variant, string> = {
  islands: COPY.variantIslands,
  untuned: COPY.variantUntuned,
  tuned: COPY.variantTuned,
  lazy: COPY.variantLazy,
};
const BASELINES = ["untuned", "tuned", "lazy"] as const;
const ENGINE_LABELS: Record<Engine, string> = {
  chromium: "Chromium",
  firefox: "Firefox",
  webkit: "WebKit",
};
const MODE_LABELS: Record<Mode, string> = {
  cold: COPY.modeCold,
  settled: COPY.modeSettled,
};

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const SLOW_4G = { latency: 150, downloadKbps: 1638.4, uploadKbps: 750 };
const SLOW_3G = { latency: 400, downloadKbps: 500, uploadKbps: 500 };
const CONDITIONS = {
  "slow-4g": {
    label: COPY.conditionSlow4g,
    viewport: DESKTOP,
    mobile: false,
    cpu: 4,
    network: SLOW_4G,
  },
  "slow-3g": {
    label: COPY.conditionSlow3g,
    viewport: DESKTOP,
    mobile: false,
    cpu: 4,
    network: SLOW_3G,
  },
  unthrottled: {
    label: COPY.conditionUnthrottled,
    viewport: DESKTOP,
    mobile: false,
    cpu: 1,
    network: null,
  },
  "mobile-slow-4g": {
    label: COPY.conditionMobile,
    viewport: PHONE,
    mobile: true,
    cpu: 4,
    network: SLOW_4G,
  },
};

const ENGINES: Array<{
  engine: Engine;
  launcher: BrowserType;
  conditions: Array<Condition>;
}> = [
  {
    engine: "chromium",
    launcher: chromium,
    conditions: ["slow-4g", "slow-3g", "unthrottled", "mobile-slow-4g"],
  },
  { engine: "firefox", launcher: firefox, conditions: ["unthrottled"] },
  { engine: "webkit", launcher: webkit, conditions: ["unthrottled"] },
];

const METRICS = [
  { key: "html", label: COPY.metricHtml, unit: "bytes" },
  { key: "bytesAtLoad", label: COPY.metricBytesLoad, unit: "bytes" },
  { key: "bytesAtEnd", label: COPY.metricBytesEnd, unit: "bytes" },
  { key: "fcp", label: COPY.metricFcp, unit: "ms" },
  { key: "domNodes", label: COPY.metricNodes, unit: "count" },
  { key: "longTasks", label: COPY.metricTasks, unit: "count" },
  { key: "overrun", label: COPY.metricOverrun, unit: "ms" },
  { key: "tbt", label: COPY.metricTbt, unit: "ms" },
  { key: "harborVisible", label: COPY.metricHarborVisible, unit: "ms" },
  { key: "harborEvent", label: COPY.metricHarborEvent, unit: "ms" },
  { key: "berthVisible", label: COPY.metricBerthVisible, unit: "ms" },
  { key: "berthEvent", label: COPY.metricBerthEvent, unit: "ms" },
  { key: "secondVisible", label: COPY.metricSecondVisible, unit: "ms" },
  { key: "secondEvent", label: COPY.metricSecondEvent, unit: "ms" },
] as const;

const METHOD = {
  cold: "No settle time: wait for the load event, then sort as soon as each header button exists.",
  settled:
    "Wait for the network to go idle, then 1.5 s, before each step (the first sort, the berth sorts, and the scroll to the berths).",
  window:
    "Each visit ends 5 s after the last sort's visible change. Long-task time covers navigation through that end point, so the sorts count as work in the window.",
  overrun:
    "Sum of (duration - 50 ms) over every long task in the window. Previously called blocking time.",
  tbt: "Sum of (duration - 50 ms) over long tasks that start at or after First Contentful Paint and before the first sort's pointerdown, so it measures the load and not the sorts. There's no TTI to end the window, because the visits don't idle for 5 s before sorting (Lighthouse dropped TTI in version 10). This window leans toward islands, which put off their work until the first interaction, so compare pages by long-task time and the sort timings, and read TBT as the cost of the load alone.",
  visible:
    "Time from pointerdown to the first frame after aria-sort changes on the target header, as before.",
  event:
    "Largest Event Timing duration among entries that start at or after the pointerdown, with durationThreshold 16 ms. Interactions under 16 ms are not reported, so they are recorded as 0. Chromium only.",
  bytes:
    "Chromium: CDP Network.loadingFinished encodedDataLength, with the main document counted as HTML. Firefox and WebKit: Playwright request.sizes(), response body plus response headers.",
  statistics:
    "Medians use the true median. IQR is Q3 minus Q1 with linear interpolation. Intervals are percentile bootstrap 95% intervals over 2000 resamples, seeded with the seed above; difference intervals resample each group separately.",
};

type Engine = "chromium" | "firefox" | "webkit";
type Mode = (typeof MODES)[number];
type Variant = (typeof VARIANTS)[number];
type Condition = keyof typeof CONDITIONS;
type Profile = (typeof CONDITIONS)[Condition];
type Metric = (typeof METRICS)[number]["key"];
type Unit = (typeof METRICS)[number]["unit"];
type BytesMethod = "cdp-network-loadingFinished" | "playwright-request-sizes";
type Section = "harbors" | "berths";
type Meter = { read: () => Promise<{ html: number; total: number }> };
type Visit = {
  engine: Engine;
  browserVersion: string;
  condition: Condition;
  mode: Mode;
  variant: Variant;
  run: number;
  bytesMethod: BytesMethod;
  trace: string | null;
  metrics: Record<Metric, number | null>;
  timeline: {
    end: number;
    fcp: number | null;
    longTasks: Array<[number, number]> | null;
    requests: Array<[number, number]>;
  };
};
type Stat = {
  median: number;
  iqr: number;
  interval: [number, number];
  n: number;
};
type Cell = {
  engine: Engine;
  condition: Condition;
  mode: Mode;
  variant: Variant;
  bytesMethod: BytesMethod;
  runs: number;
  metrics: Record<string, Stat | null>;
};
type Difference = {
  engine: Engine;
  condition: Condition;
  mode: Mode;
  baseline: Variant;
  metrics: Record<
    string,
    { difference: number; interval: [number, number]; n: number } | null
  >;
};

const files = new Map<
  string,
  { type: string; body: Buffer; isZipped: boolean } | null
>();
const COMPRESSED = new Set([".css", ".html", ".js", ".json", ".svg", ".txt"]);
const TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

async function fileAt(pathname: string) {
  const known = files.get(pathname);
  if (known !== undefined) {
    return known;
  }
  const safe = normalize(decodeURIComponent(pathname)).replace(
    /^(?:\.\.[/\\])+/u,
    "",
  );
  let found: { type: string; body: Buffer; isZipped: boolean } | null = null;
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

const execFileAsync = promisify(execFile);

async function git(args: Array<string>) {
  const { stdout } = await execFileAsync("git", args, { cwd: ROOT });
  return stdout.trim();
}

function rotate<T>(items: ReadonlyArray<T>, offset: number): Array<T> {
  const shift = offset % items.length;
  return [...items.slice(shift), ...items.slice(0, shift)];
}

function instrument() {
  const bench: Window["bench"] = { longTasks: [], events: [] };
  window.bench = bench;
  const types = PerformanceObserver.supportedEntryTypes;
  if (types.includes("longtask")) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        bench.longTasks.push([entry.startTime, entry.duration]);
      }
    }).observe({ type: "longtask" });
  }
  const eventOptions = { type: "event", durationThreshold: 16 };
  if (types.includes("event")) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry instanceof PerformanceEventTiming) {
          bench.events.push({
            start: entry.startTime,
            duration: entry.duration,
            id: entry.interactionId,
          });
        }
      }
    }).observe(eventOptions);
  }
}

async function sortColumn(page: Page, section: Section, column: string) {
  const button = page
    .locator(`[data-demo="${section}"] .harbors th`)
    .getByRole("button", { name: column, exact: true });
  await button.waitFor();
  await button.scrollIntoViewIfNeeded();
  const measured = page.evaluate(
    ({ section, column }) =>
      new Promise<{ visible: number; event: number; start: number }>((done) => {
        let start = 0;
        addEventListener(
          "pointerdown",
          (pointer) => {
            start = pointer.timeStamp;
          },
          { capture: true, once: true },
        );
        const watcher = new MutationObserver(() => {
          const headers = document.querySelectorAll(
            `[data-demo="${section}"] th[aria-sort]`,
          );
          for (const header of headers) {
            if ((header.textContent ?? "").trim() === column) {
              watcher.disconnect();
              requestAnimationFrame(() => {
                setTimeout(() => {
                  const visible = performance.now() - start;
                  setTimeout(() => {
                    let slowest = 0;
                    for (const entry of window.bench.events) {
                      if (entry.id > 0 && entry.start >= start - 1) {
                        slowest = Math.max(slowest, entry.duration);
                      }
                    }
                    done({ visible, event: slowest, start });
                  }, 100);
                });
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
  return measured;
}

function cdpMeter(session: CDPSession): Meter {
  const documents = new Set<string>();
  let html = 0;
  let total = 0;
  session.on(
    "Network.requestWillBeSent",
    (event: { requestId: string; type?: string }) => {
      if (event.type === "Document") {
        documents.add(event.requestId);
      }
    },
  );
  session.on(
    "Network.loadingFinished",
    (event: { requestId: string; encodedDataLength: number }) => {
      total += event.encodedDataLength;
      if (documents.has(event.requestId)) {
        html += event.encodedDataLength;
      }
    },
  );
  return { read: () => Promise.resolve({ html, total }) };
}

function requestMeter(page: Page): Meter {
  const finished: Array<Promise<{ document: boolean; bytes: number }>> = [];
  page.on("requestfinished", (request) => {
    finished.push(
      request
        .sizes()
        .then((size) => ({
          document: request.resourceType() === "document",
          bytes: size.responseBodySize + size.responseHeadersSize,
        })),
    );
  });
  return {
    read: async () => {
      const sizes = await Promise.all(finished);
      let html = 0;
      let total = 0;
      for (const size of sizes) {
        total += size.bytes;
        if (size.document) {
          html += size.bytes;
        }
      }
      return { html, total };
    },
  };
}

async function chromiumMeter(
  context: BrowserContext,
  page: Page,
  profile: Profile,
): Promise<Meter> {
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
  if (profile.network != null) {
    await session.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: profile.network.latency,
      downloadThroughput: (profile.network.downloadKbps * 1024) / 8,
      uploadThroughput: (profile.network.uploadKbps * 1024) / 8,
    });
  }
  return cdpMeter(session);
}

function overrun(tasks: Array<[number, number]>, from: number, to: number) {
  let total = 0;
  for (const [start, duration] of tasks) {
    if (start >= from && start < to) {
      total += duration - LONG_TASK;
    }
  }
  return total;
}

type Plan = {
  condition: Condition;
  mode: Mode;
  variant: Variant;
  origin: string;
};

async function walk(page: Page, meter: Meter, plan: Plan) {
  await page.goto(`${plan.origin}${PATHS[plan.variant]}`, {
    waitUntil: plan.mode === "cold" ? "load" : "networkidle",
  });
  if (plan.mode === "settled") {
    await page.waitForTimeout(SETTLE);
  }
  const atLoad = await meter.read();
  const nodesAtLoad = await page.evaluate(
    () => document.getElementsByTagName("*").length,
  );

  const settle = async () => {
    if (plan.mode === "settled") {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(SETTLE);
    }
  };
  const harbor = await sortColumn(page, "harbors", "On time");
  await page.locator('[data-demo="berths"]').scrollIntoViewIfNeeded();
  await settle();
  const berth = await sortColumn(page, "berths", "On time");
  await settle();
  const second = await sortColumn(page, "berths", "Arrivals");
  await page.waitForTimeout(TAIL);

  const atEnd = await meter.read();
  const reading = await page.evaluate(() => {
    const requests: Array<[number, number]> = [];
    for (const entry of performance.getEntriesByType("resource")) {
      if (entry instanceof PerformanceResourceTiming) {
        requests.push([entry.startTime, entry.responseEnd]);
      }
    }
    return {
      now: performance.now(),
      fcp:
        performance.getEntriesByName("first-contentful-paint")[0]?.startTime ??
        null,
      longTasks: window.bench.longTasks,
      requests,
    };
  });
  return { atLoad, nodesAtLoad, harbor, berth, second, atEnd, reading };
}

async function visit(browser: Browser, engine: Engine, plan: Plan) {
  const profile = CONDITIONS[plan.condition];
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.mobile,
    hasTouch: profile.mobile,
  });
  const page = await context.newPage();
  await page.addInitScript(instrument);
  const chromiumRun = engine === "chromium";
  const meter = chromiumRun
    ? await chromiumMeter(context, page, profile)
    : requestMeter(page);
  if (chromiumRun) {
    await browser.startTracing(page, {
      screenshots: false,
      categories: TRACE_CATEGORIES,
    });
  }

  let walked: Awaited<ReturnType<typeof walk>>;
  let trace: Buffer | null;
  try {
    walked = await walk(page, meter, plan);
  } finally {
    trace = chromiumRun ? await browser.stopTracing() : null;
    await context.close();
  }
  const { atLoad, nodesAtLoad, harbor, berth, second, atEnd, reading } = walked;

  const tasks = chromiumRun ? reading.longTasks : null;
  const fcp = reading.fcp;
  const tbt =
    tasks == null || fcp == null ? null : overrun(tasks, fcp, harbor.start);
  const metrics: Record<Metric, number | null> = {
    html: atEnd.html,
    bytesAtLoad: atLoad.total,
    bytesAtEnd: atEnd.total,
    fcp,
    domNodes: nodesAtLoad,
    longTasks: tasks == null ? null : tasks.length,
    overrun: tasks == null ? null : overrun(tasks, -Infinity, Infinity),
    tbt,
    harborVisible: harbor.visible,
    harborEvent: chromiumRun ? harbor.event : null,
    berthVisible: berth.visible,
    berthEvent: chromiumRun ? berth.event : null,
    secondVisible: second.visible,
    secondEvent: chromiumRun ? second.event : null,
  };
  const bytesMethod: BytesMethod = chromiumRun
    ? "cdp-network-loadingFinished"
    : "playwright-request-sizes";
  return {
    metrics,
    trace,
    bytesMethod,
    timeline: {
      end: reading.now,
      fcp,
      firstInput: harbor.start,
      longTasks: tasks,
      requests: reading.requests,
    },
  };
}

async function attempt<T>(name: string, run: () => Promise<T>) {
  for (let tries = 1; ; tries += 1) {
    try {
      return await run();
    } catch (error) {
      if (tries === ATTEMPTS) {
        throw error;
      }
      console.warn(`${name} failed, trying again: ${String(error)}`);
    }
  }
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted: Array<number>, p: number) {
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  const lowValue = sorted[low] ?? 0;
  const highValue = sorted[high] ?? 0;
  return lowValue + (at - low) * (highValue - lowValue);
}

function medianOf(values: Array<number>) {
  return quantile(
    values.toSorted((a, b) => a - b),
    0.5,
  );
}

function resample(values: Array<number>, random: () => number) {
  return Array.from(
    { length: values.length },
    () => values[Math.floor(random() * values.length)] ?? 0,
  );
}

function intervalOf(draws: Array<number>): [number, number] {
  const sorted = draws.toSorted((a, b) => a - b);
  return [quantile(sorted, 0.025), quantile(sorted, 0.975)];
}

function statOf(values: Array<number>, random: () => number): Stat {
  const sorted = values.toSorted((a, b) => a - b);
  const medians = Array.from({ length: RESAMPLES }, () =>
    medianOf(resample(values, random)),
  );
  return {
    median: quantile(sorted, 0.5),
    iqr: quantile(sorted, 0.75) - quantile(sorted, 0.25),
    interval: intervalOf(medians),
    n: values.length,
  };
}

function differenceOf(
  islands: Array<number>,
  baseline: Array<number>,
  random: () => number,
) {
  const draws = Array.from(
    { length: RESAMPLES },
    () =>
      medianOf(resample(islands, random)) -
      medianOf(resample(baseline, random)),
  );
  return {
    difference: medianOf(islands) - medianOf(baseline),
    interval: intervalOf(draws),
    n: islands.length,
  };
}

function valuesOf(visits: Array<Visit>, key: Metric) {
  const values: Array<number> = [];
  for (const visit of visits) {
    const value = visit.metrics[key];
    if (value != null) {
      values.push(value);
    }
  }
  return values;
}

function scaled(value: number, unit: Unit) {
  const rounded =
    unit === "bytes" ? Math.round(value / 1024) : Math.round(value);
  return rounded.toLocaleString("en-US");
}

function suffix(unit: Unit) {
  if (unit === "bytes") {
    return " KB";
  }
  return unit === "ms" ? " ms" : "";
}

function cellText(stat: Stat | null, unit: Unit, runs: number) {
  if (stat == null) {
    return "n/a";
  }
  const [low, high] = stat.interval;
  const count = stat.n === runs ? "" : `, ${stat.n} runs`;
  return `${scaled(stat.median, unit)}${suffix(unit)} (${scaled(low, unit)} to ${scaled(high, unit)}${count})`;
}

function differenceText(
  difference: { difference: number; interval: [number, number] } | null,
  unit: Unit,
) {
  if (difference == null) {
    return "n/a";
  }
  const [low, high] = difference.interval;
  const sign = difference.difference > 0 ? "+" : "";
  return `${sign}${scaled(difference.difference, unit)}${suffix(unit)} (${scaled(low, unit)} to ${scaled(high, unit)})`;
}

function fill(template: string, values: Record<string, string | number>) {
  let text = template;
  for (const [key, value] of Object.entries(values)) {
    text = text.replaceAll(`{${key}}`, String(value));
  }
  return text;
}

function tableOf(
  heading: string,
  header: Array<string>,
  rows: Array<Array<string>>,
) {
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map((_, index) => (index === 0 ? "---" : "---:")).join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ];
  return [heading, "", ...lines].join("\n");
}

function groupMarkdown(
  cells: Array<Cell>,
  differences: Array<Difference>,
  engine: Engine,
  condition: Condition,
  mode: Mode,
  runs: number,
) {
  const group = cells.filter(
    (cell) =>
      cell.engine === engine &&
      cell.condition === condition &&
      cell.mode === mode,
  );
  const groupDifferences = differences.filter(
    (difference) =>
      difference.engine === engine &&
      difference.condition === condition &&
      difference.mode === mode,
  );
  const heading = `#### ${ENGINE_LABELS[engine]}, ${CONDITIONS[condition].label}, ${MODE_LABELS[mode]}`;
  const bytesNote =
    engine === "chromium" ? COPY.bytesCdp : COPY.bytesPlaywright;
  const valueRows = METRICS.map(({ key, label, unit }) => [
    label,
    ...VARIANTS.map((variant) => {
      const cell = group.find((item) => item.variant === variant);
      return cellText(cell?.metrics[key] ?? null, unit, runs);
    }),
  ]);
  const differenceRows = METRICS.map(({ key, label, unit }) => [
    label,
    ...BASELINES.map((baseline) => {
      const found = groupDifferences.find((item) => item.baseline === baseline);
      return differenceText(found?.metrics[key] ?? null, unit);
    }),
  ]);
  return [
    heading,
    "",
    bytesNote,
    "",
    tableOf(
      "",
      [
        COPY.metricHeader,
        ...VARIANTS.map((variant) => VARIANT_LABELS[variant]),
      ],
      valueRows,
    ).trimStart(),
    "",
    `**${COPY.differenceHeading}**`,
    "",
    tableOf(
      "",
      [
        COPY.metricHeader,
        ...BASELINES.map((baseline) => VARIANT_LABELS[baseline]),
      ],
      differenceRows,
    ).trimStart(),
  ].join("\n");
}

const { origin, close } = await serve();
await rm(RAW, { recursive: true, force: true });
await mkdir(RAW, { recursive: true });
const commit = await git(["rev-parse", "HEAD"]);
const dirty = (await git(["status", "--porcelain"])) !== "";

const visits: Array<Visit> = [];
const versions: Record<string, string> = {};
for (const { engine, launcher, conditions } of ENGINES) {
  const browser = await launcher.launch({
    executablePath:
      engine === "chromium" ? process.env.PLAYWRIGHT_CHROMIUM_PATH : undefined,
  });
  const browserVersion = browser.version();
  versions[engine] = browserVersion;
  for (const condition of conditions) {
    for (let index = 0; index < RUNS; index += 1) {
      for (const mode of rotate(MODES, index)) {
        for (const variant of rotate(VARIANTS, index)) {
          const run = index + 1;
          const name = `${engine}-${condition}-${mode}-${variant}-${String(run).padStart(2, "0")}`;
          const result = await attempt(name, () =>
            visit(browser, engine, { condition, mode, variant, origin }),
          );
          if (result.trace != null) {
            await writeFile(
              join(RAW, `${name}.trace.json.gz`),
              gzipSync(result.trace),
            );
          }
          const record: Visit = {
            engine,
            browserVersion,
            condition,
            mode,
            variant,
            run,
            bytesMethod: result.bytesMethod,
            trace: result.trace == null ? null : `${name}.trace.json.gz`,
            metrics: result.metrics,
            timeline: result.timeline,
          };
          await writeFile(
            join(RAW, `${name}.json`),
            `${JSON.stringify(record, null, 2)}\n`,
          );
          visits.push(record);
          console.log(name, JSON.stringify(result.metrics));
        }
      }
    }
  }
  await browser.close();
}
close();

const random = mulberry32(SEED);
const cells: Array<Cell> = [];
const differences: Array<Difference> = [];
for (const { engine, conditions } of ENGINES) {
  for (const condition of conditions) {
    for (const mode of MODES) {
      for (const variant of VARIANTS) {
        const group = visits.filter(
          (visit) =>
            visit.engine === engine &&
            visit.condition === condition &&
            visit.mode === mode &&
            visit.variant === variant,
        );
        if (group.length === 0) {
          continue;
        }
        const metrics: Record<string, Stat | null> = {};
        for (const { key } of METRICS) {
          const values = valuesOf(group, key);
          metrics[key] = values.length === 0 ? null : statOf(values, random);
        }
        cells.push({
          engine,
          condition,
          mode,
          variant,
          bytesMethod: group[0]?.bytesMethod ?? "playwright-request-sizes",
          runs: group.length,
          metrics,
        });
      }
      for (const baseline of BASELINES) {
        const islands = visits.filter(
          (visit) =>
            visit.engine === engine &&
            visit.condition === condition &&
            visit.mode === mode &&
            visit.variant === "islands",
        );
        const other = visits.filter(
          (visit) =>
            visit.engine === engine &&
            visit.condition === condition &&
            visit.mode === mode &&
            visit.variant === baseline,
        );
        const metrics: Difference["metrics"] = {};
        for (const { key } of METRICS) {
          const left = valuesOf(islands, key);
          const right = valuesOf(other, key);
          metrics[key] =
            left.length === 0 || right.length === 0
              ? null
              : differenceOf(left, right, random);
        }
        differences.push({ engine, condition, mode, baseline, metrics });
      }
    }
  }
}

const headlineCell = (variant: Variant) =>
  cells.find(
    (cell) =>
      cell.engine === "chromium" &&
      cell.condition === "slow-4g" &&
      cell.mode === "settled" &&
      cell.variant === variant,
  );
const headline = (cell: Cell | undefined) => ({
  html: cell?.metrics.html?.median ?? 0,
  total: cell?.metrics.bytesAtLoad?.median ?? 0,
  tasks: cell?.metrics.longTasks?.median ?? null,
  blocking: cell?.metrics.overrun?.median ?? null,
});

const versionOf = async (name: string) => {
  const manifest: unknown = JSON.parse(
    await readFile(join(ROOT, "node_modules", name, "package.json"), "utf8"),
  );
  return typeof manifest === "object" &&
    manifest != null &&
    "version" in manifest
    ? String(manifest.version)
    : "unknown";
};
const date = new Date().toLocaleDateString("en-US", { dateStyle: "long" });
const cpu = cpus()[0]?.model.trim() ?? "an unknown CPU";
const productVersion =
  process.platform === "darwin"
    ? (await execFileAsync("sw_vers", ["-productVersion"])).stdout.trim()
    : release();
const osLabel = `${process.platform === "darwin" ? "macOS" : process.platform} ${productVersion}`;
const packages = {
  svelte: await versionOf("svelte"),
  kit: await versionOf("@sveltejs/kit"),
  node: process.versions.node,
};
const machine = `Chromium ${versions.chromium ?? "unknown"} on ${cpu}`;

await writeFile(
  SUMMARY,
  `${JSON.stringify(
    {
      date,
      machine,
      runs: RUNS,
      seed: SEED,
      resamples: RESAMPLES,
      git: { commit, dirty },
      environment: {
        os: osLabel,
        cpu: `${cpu}, ${cpus().length} logical cores`,
        browsers: versions,
        packages,
      },
      method: METHOD,
      conditions: CONDITIONS,
      plain: headline(headlineCell("untuned")),
      islands: headline(headlineCell("islands")),
      cells,
      differences,
    },
    null,
    2,
  )}\n`,
);

const names = (await readdir(RAW))
  .filter((name) => name !== "checksums.txt")
  .toSorted();
const sums: Array<string> = [];
for (const name of names) {
  const digest = createHash("sha256")
    .update(await readFile(join(RAW, name)))
    .digest("hex");
  sums.push(`${digest}  ${name}`);
}
await writeFile(join(RAW, "checksums.txt"), `${sums.join("\n")}\n`);

const pageText = await readFile(PAGE, "utf8");
if (!RESULTS.test(pageText)) {
  throw new Error("The benchmark page has no results block.");
}
const groups: Array<string> = [];
for (const { engine, conditions } of ENGINES) {
  for (const condition of conditions) {
    for (const mode of MODES) {
      if (
        visits.some(
          (visit) =>
            visit.engine === engine &&
            visit.condition === condition &&
            visit.mode === mode,
        )
      ) {
        groups.push(
          groupMarkdown(cells, differences, engine, condition, mode, RUNS),
        );
      }
    }
  }
}
const note = fill(COPY.recordedNote, {
  date,
  machine,
  svelte: packages.svelte,
  kit: packages.kit,
  commit: `${commit.slice(0, 7)}${dirty ? " (with uncommitted changes)" : ""}`,
});
const block = [
  "<!-- results -->",
  "",
  note,
  "",
  fill(COPY.cellsNote, { runs: RUNS }),
  "",
  COPY.modeNote,
  "",
  ...groups.flatMap((group) => [group, ""]),
  "<!-- /results -->",
].join("\n");
await writeFile(
  PAGE,
  pageText.replace(RESULTS, () => block),
);
console.log(`Wrote ${visits.length} runs and ${cells.length} cells.`);
