import type { Attachment } from "svelte/attachments";
import { untrack } from "svelte";
import { on } from "svelte/events";
import type { Fresh, Strategy } from "./part.js";
import { arrivals } from "./arrivals.svelte.js";
import { coded } from "./errors.js";
import { emit, isObserved } from "./observe.js";
import { deserialize, onArrival, Part, quietly, settings } from "./part.js";

const BUDGET = 64 * 1024 ** 2;
const MARGIN = "320px";
const DELAYS = [1000, 3000, 5000];
const SHAPES = "skeletons.json";
const SAVED = "svelte-islands:skeletons";
const SAVED_LIMIT = 512 * 1024;
const BUSY = ".island-shell, [aria-busy='true']";
const RETRY = 250;
const RETRY_LIMIT = 4000;
const INTENTS = ["pointerover", "pointerdown", "focusin", "touchstart"];
const SLICE = 8;
const PREFETCH_BUDGET = 1024 ** 2;
const RANKS: Record<Strategy, number> = {
  interaction: 0,
  eager: 1,
  visible: 1,
  media: 2,
  idle: 3,
  never: 3,
};

export class Gone extends Error {}

const values = new Map<string, { value: unknown; bytes: number }>();
const pending = new Map<string, Promise<unknown>>();
const skeletons = new Map<string, string>();
const saved = new Map<string, string>();
const claimed = new WeakSet<Element>();
const refreshed = new Set<string>();
const watched = new Map<Element, Set<() => void>>();
const observers = new Map<string, IntersectionObserver>();
const wants = new Set<(want: Want) => void>();
type Prefetched = {
  part: Part;
  outcome: "pending" | "arrived" | "used" | "late";
};

const prefetched = new Map<string, Prefetched>();
const intents = new WeakMap<Element, Set<() => void>>();
const state: {
  held: number;
  prefetched: number;
  prefetchedOn: string;
  isBooted: boolean;
  isRead: boolean;
  isDraining: boolean;
  isListening: boolean;
  isFinding: boolean;
  isIntending: boolean;
  isSummarizing: boolean;
  reads: Set<Part> | null;
} = {
  held: 0,
  prefetched: 0,
  prefetchedOn: "",
  isBooted: false,
  isRead: false,
  isDraining: false,
  isListening: false,
  isFinding: false,
  isIntending: false,
  isSummarizing: false,
  reads: null,
};

type Job = { run: () => void; rank: number; isDone: boolean };

const queue: Array<Job> = [];

export type Options = { margin?: string; media?: string };

/** Why the reader needs everything now: find in page, or printing. */
export type Want = "find" | "print";

export type Claimed = {
  state: "static" | "deferred" | "client" | "fresh";
  file: string | null;
  needs: string | null;
  isBusy: boolean;
  element: HTMLElement;
};

function nothing() {}

function keep(hash: string, value: unknown, bytes: number) {
  values.set(hash, { value, bytes });
  arrivals.bump();
  state.held += bytes;
  for (const [oldest, kept] of values) {
    if (oldest === hash || state.held <= BUDGET) {
      break;
    }
    values.delete(oldest);
    state.held -= kept.bytes;
  }
}

export function reading<T>(run: () => T) {
  const outer = state.reads;
  const found = new Set<Part>();
  state.reads = found;
  try {
    return { result: run(), reads: found };
  } finally {
    state.reads = outer;
  }
}

export function needsOf(found: Set<Part>, self: Part) {
  const needs = found
    .values()
    .filter(
      (read) =>
        read.hash !== self.hash && read.loaded != null && !read.isInline,
    )
    .map((read) => [read.hash, read.source, read.bytes])
    .toArray();
  return needs.length === 0 ? null : JSON.stringify(needs);
}

export function partsOf(needs: string | null) {
  return needs == null
    ? []
    : (JSON.parse(needs) as Array<[string, string, number]>).map(
        ([hash, source, bytes]) =>
          new Part({ name: hash, hash, source, bytes }),
      );
}

/**
 * Reads a part's value if it's already here, without requesting it. Use it in
 * script or markup, where it stays reactive to the part arriving.
 *
 * @param part The part to read.
 * @returns The value in a wrapper, or `null` if the part hasn't arrived.
 */
export function peek<T>(part: Part<T>): { value: T } | null {
  state.reads?.add(part);
  if (part.loaded != null) {
    return part.loaded;
  }
  void arrivals.version;
  const found = values.get(part.hash);
  if (found == null) {
    return null;
  }
  values.delete(part.hash);
  values.set(part.hash, found);
  return { value: found.value as T };
}

type Priority = "high" | "low" | "auto";

function pageFor(source: string) {
  return source === location.pathname
    ? `${location.pathname}${location.search}`
    : source;
}

async function fetched(name: string, source: string, priority: Priority) {
  const url = new URL(`${settings.prefix}${name}`, location.origin);
  const response = await fetch(url, { priority });
  if (response.ok) {
    return response.text();
  }
  if (response.status !== 404) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  url.searchParams.set("u", pageFor(source));
  const rebuilt = await fetch(url, { priority });
  if (rebuilt.ok) {
    return rebuilt.text();
  }
  throw rebuilt.status === 404
    ? new Gone(name)
    : new Error(`${rebuilt.status} ${rebuilt.statusText}`);
}

async function pause(delay: number) {
  await new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

async function persist<T>(run: () => Promise<T>) {
  for (const delay of DELAYS) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Gone) {
        throw error;
      }
      await pause(delay);
    }
  }
  return run();
}

function shared() {
  const scope: typeof globalThis & {
    __svelteIslands?: {
      isClaiming?: boolean;
      early?: Map<string, Promise<string | null>>;
    };
  } = globalThis;
  scope.__svelteIslands ??= {};
  return scope.__svelteIslands;
}

type Batch = { found: Promise<Array<Fresh>>; taken: Map<string, number> };

const freshened: { batch: Batch | null } = { batch: null };

async function fetchFresh() {
  await pause(0);
  const url = new URL(`${settings.prefix}fresh`, location.origin);
  url.searchParams.set("u", `${location.pathname}${location.search}`);
  const response = await fetch(url, { cache: "no-store", priority: "high" });
  if (!response.ok) {
    throw response.status === 503
      ? new Error(response.statusText)
      : new Gone("fresh");
  }
  return deserialize(await response.text()) as Array<Fresh>;
}

async function settle(promise: Promise<unknown>, done: () => void) {
  try {
    await promise;
  } catch {
    return;
  } finally {
    done();
  }
}

export async function freshOf<T = unknown>(
  key: string,
): Promise<Fresh<T> | null> {
  let batch = freshened.batch;
  if (batch == null) {
    const made: Batch = { found: persist(fetchFresh), taken: new Map() };
    const clear = () => {
      if (freshened.batch === made) {
        freshened.batch = null;
      }
    };
    void settle(made.found, clear);
    freshened.batch = made;
    batch = made;
  }
  const index = batch.taken.get(key) ?? 0;
  batch.taken.set(key, index + 1);
  const found = await batch.found;
  return (
    (found.filter((island) => island.key === key)[index] as
      | Fresh<T>
      | undefined) ?? null
  );
}

export function holdSwaps() {
  shared().isClaiming = true;
}

async function handed(file: string) {
  const { early } = shared();
  const found = early?.get(file);
  early?.delete(file);
  return found ?? null;
}

export async function markupOf(
  file: string,
  source: string,
  { name, hash }: Part,
) {
  const started = performance.now();
  try {
    const text =
      (await handed(file)) ??
      (await persist(async () => fetched(file, source, "auto")));
    if (isObserved()) {
      emit({
        type: "markup",
        name,
        hash,
        bytes: text.length,
        duration: performance.now() - started,
      });
    }
    return text;
  } catch (error) {
    report(name, hash, error);
    throw error;
  }
}

function report(name: string, hash: string, error: unknown) {
  console.warn(
    coded("islands_part_failed", `Couldn't load the part "${name}".`),
    error,
  );
  if (isObserved()) {
    emit({ type: "fail", name, hash, message: String(error) });
  }
}

export function markupNow(name: string, source: string) {
  const url = new URL(`${settings.prefix}${name}`, location.origin);
  const send = () => {
    const request = new XMLHttpRequest();
    request.open("GET", url, false);
    request.send();
    return request;
  };
  try {
    let found = send();
    if (found.status === 404) {
      url.searchParams.set("u", pageFor(source));
      found = send();
    }
    return found.status === 200 ? found.responseText : null;
  } catch {
    return null;
  }
}

/**
 * Reads a part right now, blocking the page with a synchronous request if it
 * has to. Keep it for moments that can't wait, such as `beforeprint`.
 *
 * @param part The part to read.
 * @returns The value in a wrapper, or `null` if the request failed.
 */
export function loadNow<T>(part: Part<T>): { value: T } | null {
  const known = peek(part);
  if (known != null) {
    return known;
  }
  const text = markupNow(`${part.hash}.json`, part.source);
  if (text == null) {
    return null;
  }
  const value = deserialize(text) as T;
  keep(part.hash, value, part.bytes);
  return { value };
}

async function request(part: Part, priority: Priority) {
  const started = performance.now();
  try {
    const value = deserialize(
      await persist(async () =>
        fetched(`${part.hash}.json`, part.source, priority),
      ),
    );
    keep(part.hash, value, part.bytes);
    if (isObserved()) {
      emit({
        type: "load",
        name: part.name,
        hash: part.hash,
        bytes: part.bytes,
        duration: performance.now() - started,
        isPrefetch: priority === "low",
      });
    }
    return value;
  } catch (error) {
    report(part.name, part.hash, error);
    throw error;
  } finally {
    pending.delete(part.hash);
  }
}

/**
 * Requests a part's value, or returns it if it's already here. Requests for the
 * same part share one download, and failed downloads are retried.
 *
 * @param part The part to read.
 * @returns The value.
 */
export async function load<T>(part: Part<T>): Promise<T> {
  return fetchPart(part, "auto");
}

export async function loadSoon<T>(part: Part<T>): Promise<T> {
  return fetchPart(part, "high");
}

async function fetchPart<T>(part: Part<T>, priority: Priority): Promise<T> {
  const early = priority === "low" ? null : prefetched.get(part.hash);
  if (early?.outcome === "pending") {
    early.outcome = "late";
  } else if (early?.outcome === "arrived") {
    early.outcome = "used";
  }
  const known = untrack(() => peek(part));
  if (known != null) {
    return known.value;
  }
  let found = pending.get(part.hash);
  if (found == null) {
    found = request(part, priority);
    pending.set(part.hash, found);
  }
  return (await found) as T;
}

function isThrifty() {
  const { connection } = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  return (
    connection?.saveData === true ||
    connection?.effectiveType === "slow-2g" ||
    connection?.effectiveType === "2g"
  );
}

export function isPrefetched(part: Part) {
  return prefetched.has(part.hash);
}

function summarize() {
  if (prefetched.size === 0) {
    return;
  }
  if (isObserved()) {
    emit({
      type: "prefetch",
      parts: [...prefetched.values()].map(({ part, outcome }) => ({
        name: part.name,
        hash: part.hash,
        outcome:
          outcome === "pending" || outcome === "arrived" ? "wasted" : outcome,
      })),
    });
  }
  prefetched.clear();
}

export function prefetch(parts: ReadonlyArray<Part>, extra: () => void) {
  const missing = parts.filter(
    (part) => peek(part) == null && !pending.has(part.hash),
  );
  let bytes = 0;
  for (const part of missing) {
    bytes += part.bytes;
  }
  const page = `${location.pathname}${location.search}`;
  if (state.prefetchedOn !== page) {
    summarize();
    state.prefetchedOn = page;
    state.prefetched = 0;
  }
  if (!state.isSummarizing) {
    state.isSummarizing = true;
    addEventListener("pagehide", summarize);
  }
  if (isThrifty() || state.prefetched + bytes > PREFETCH_BUDGET) {
    return;
  }
  state.prefetched += bytes;
  for (const part of missing) {
    const entry: Prefetched = { part, outcome: "pending" };
    prefetched.set(part.hash, entry);
    void quietly(
      fetchPart(part, "low").then(() => {
        if (entry.outcome === "pending") {
          entry.outcome = "arrived";
        }
      }),
    );
  }
  extra();
}

onArrival((part) => {
  if (typeof window !== "undefined" && part.isEager && part.loaded == null) {
    void quietly(load(part));
  }
});

export function isFirstGone(hash: string) {
  if (refreshed.has(hash)) {
    return false;
  }
  refreshed.add(hash);
  return true;
}

function merge(found: unknown, into: Map<string, string>) {
  if (typeof found !== "object" || found == null) {
    return;
  }
  for (const [key, html] of Object.entries(found)) {
    if (typeof html === "string") {
      into.set(key, html);
    }
  }
}

async function fetchShapes() {
  const response = await fetch(`${settings.prefix}${SHAPES}`);
  if (response.ok) {
    merge(await response.json(), skeletons);
  }
}

function announce(want: Want) {
  for (const run of wants) {
    try {
      run(want);
    } catch (error) {
      reportError(error);
    }
  }
}

function listen() {
  if (state.isListening) {
    return;
  }
  state.isListening = true;
  addEventListener("beforeprint", () => {
    announce("print");
  });
  addEventListener("keydown", (event) => {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.defaultPrevented ||
      event.key.toLowerCase() !== "f"
    ) {
      return;
    }
    state.isFinding = true;
    announce("find");
  });
}

/**
 * Calls back when the reader needs content that's waiting on the page: when they
 * open find in page, or are about to print. Use it for anything you load later.
 *
 * @param run Called with the reason. Printing needs its content before this returns.
 * @returns A function that stops listening.
 */
export function whenWanted(run: (want: Want) => void): () => void {
  listen();
  wants.add(run);
  if (state.isFinding) {
    queueMicrotask(() => {
      if (wants.has(run)) {
        run("find");
      }
    });
  }
  return () => {
    wants.delete(run);
  };
}

export function boot() {
  if (state.isBooted) {
    return;
  }
  state.isBooted = true;
  idle(() => {
    void quietly(fetchShapes());
  });
}

const CLAIMABLE: ReadonlySet<string> = new Set([
  "static",
  "deferred",
  "client",
  "fresh",
]);

function isClaimable(value: string | undefined): value is Claimed["state"] {
  return value != null && CLAIMABLE.has(value);
}

export function claim(part: Part, key: string): Claimed | null {
  if (typeof document === "undefined" || state.isBooted) {
    return null;
  }
  shared().isClaiming = true;
  const candidates = document.querySelectorAll(
    `[data-island="${CSS.escape(part.hash)}"]`,
  );
  for (const element of candidates) {
    if (!(element instanceof HTMLElement) || claimed.has(element)) {
      continue;
    }
    const found = element.dataset.islandState;
    if (isClaimable(found)) {
      claimed.add(element);
      const skeleton = element.querySelector(":scope > .island-shell");
      if (
        found !== "static" &&
        skeleton != null &&
        skeleton.querySelector(":scope > .island-fallback") == null &&
        !skeletons.has(key)
      ) {
        skeletons.set(key, skeleton.getHTML());
      }
      return {
        state: found,
        file: element.dataset.islandFile ?? null,
        needs: element.dataset.islandNeeds ?? null,
        isBusy: element.getAttribute("aria-busy") === "true",
        element,
      };
    }
  }
  return null;
}

function read() {
  if (typeof document === "undefined" || state.isRead) {
    return;
  }
  state.isRead = true;
  try {
    merge(JSON.parse(localStorage.getItem(SAVED) ?? "null"), saved);
  } catch {
    saved.clear();
  }
}

function save(key: string, html: string) {
  saved.set(key, html);
  try {
    const text = JSON.stringify(Object.fromEntries(saved));
    if (text.length <= SAVED_LIMIT) {
      localStorage.setItem(SAVED, text);
    }
  } catch {
    saved.delete(key);
  }
}

export function skeletonOf(key: string) {
  read();
  return skeletons.get(key) ?? saved.get(key) ?? null;
}

const WIDTHS = [48, 41, 45, 33, 47, 38, 29, 44];

export function fallback(bytes: number, reserve?: string) {
  if (reserve != null) {
    return `<div class="island-fallback"><span class="island-media" style="block-size:${reserve}"></span></div>`;
  }
  const lines = Math.min(12, Math.max(3, Math.round(Math.log2(bytes / 512))));
  const bones = Array.from(
    { length: lines },
    (_, at) =>
      `<span class="island-bone island-line" style="--n:${WIDTHS[at % WIDTHS.length] ?? 40}"></span>`,
  ).join("");
  return `<div class="island-fallback">${bones}</div>`;
}

export function idle(run: () => void) {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(run, { timeout: 2000 });
    return () => {
      cancelIdleCallback(id);
    };
  }
  const id = setTimeout(run, 200);
  return () => {
    clearTimeout(id);
  };
}

const shaping: {
  promise: Promise<(element: Element) => string | null> | null;
} = { promise: null };

async function loadShaper() {
  const { shape } = await import("./skeleton.js");
  return shape;
}

export async function shaper() {
  shaping.promise ??= loadShaper();
  return shaping.promise;
}

async function learnFrom(key: string, element: Element) {
  const shape = await shaper();
  const shaped = shape(element);
  if (shaped != null && shaped !== "" && !skeletons.has(key)) {
    skeletons.set(key, shaped);
    save(key, shaped);
  }
}

export function capture(key: string, element: Element) {
  read();
  if (skeletons.has(key)) {
    return nothing;
  }
  let wait = RETRY;
  let cancel = nothing;
  const attempt = () => {
    if (element.querySelector(BUSY) != null) {
      const timer = setTimeout(() => {
        cancel = idle(attempt);
      }, wait);
      wait = Math.min(wait * 2, RETRY_LIMIT);
      cancel = () => {
        clearTimeout(timer);
      };
      return;
    }
    void quietly(learnFrom(key, element));
  };
  cancel = idle(attempt);
  return () => {
    cancel();
  };
}

/**
 * An attachment that records an element's shape as the skeleton for `name`, for
 * content you render yourself without an island.
 *
 * @param name The skeleton's name.
 * @returns The attachment, for `{@attach learn("name")}`.
 */
export function learn(name: string): Attachment {
  return (element: Element) => capture(name, element);
}

export function boxes(element: Element): Array<Element> {
  return getComputedStyle(element).display === "contents"
    ? [...element.children].flatMap((child) => boxes(child))
    : [element];
}

export function heightOf(element: Element) {
  const rects = boxes(element).map((box) => box.getBoundingClientRect());
  return rects.length === 0
    ? 0
    : Math.max(...rects.map(({ bottom }) => bottom)) -
        Math.min(...rects.map(({ top }) => top));
}

function observerOf(margin: string) {
  let found = observers.get(margin);
  if (found == null) {
    found = new IntersectionObserver(
      (entries) => {
        const reached = entries.filter((entry) => entry.isIntersecting);
        for (const entry of reached) {
          const starts = [...(watched.get(entry.target) ?? [])];
          for (const start of starts) {
            start();
          }
        }
      },
      { rootMargin: margin },
    );
    observers.set(margin, found);
  }
  return found;
}

function visible(element: Element, start: () => void, options: Options) {
  const observer = observerOf(options.margin ?? MARGIN);
  const targets = boxes(element);
  if (targets.length === 0) {
    queueMicrotask(start);
    return nothing;
  }
  for (const target of targets) {
    let starts = watched.get(target);
    if (starts == null) {
      starts = new Set();
      watched.set(target, starts);
    }
    starts.add(start);
    observer.observe(target);
  }
  return () => {
    for (const target of targets) {
      const starts = watched.get(target);
      starts?.delete(start);
      if (starts == null || starts.size === 0) {
        watched.delete(target);
        observer.unobserve(target);
      }
    }
  };
}

function matched(_: Element, start: () => void, options: Options) {
  if (options.media == null) {
    return soon(start);
  }
  const list = matchMedia(options.media);
  if (list.matches) {
    return soon(start);
  }
  return on(list, "change", () => {
    if (list.matches) {
      start();
    }
  });
}

function intended(event: Event) {
  for (
    let node = event.target instanceof Element ? event.target : null;
    node != null;
    node = node.parentElement
  ) {
    for (const run of intents.get(node) ?? []) {
      run();
    }
  }
}

/**
 * Calls `run` when someone points at, presses, focuses, or touches something
 * inside `element`, through one set of listeners on the document.
 */
export function onIntent(element: Element, run: () => void) {
  if (!state.isIntending) {
    state.isIntending = true;
    for (const type of INTENTS) {
      addEventListener(type, intended, { passive: true, capture: true });
    }
  }
  let runs = intents.get(element);
  if (runs == null) {
    runs = new Set();
    intents.set(element, runs);
  }
  const entry = () => {
    run();
  };
  runs.add(entry);
  return () => {
    runs.delete(entry);
  };
}

async function breathe() {
  if (typeof scheduler !== "undefined" && "yield" in scheduler) {
    return scheduler.yield();
  }
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function next() {
  let found: Job | null = null;
  for (const job of queue) {
    if (!job.isDone && (found == null || job.rank < found.rank)) {
      found = job;
    }
  }
  return found;
}

function prune() {
  const kept = queue.filter((job) => !job.isDone);
  queue.length = 0;
  queue.push(...kept);
}

async function drain() {
  state.isDraining = true;
  while (next() != null) {
    await breathe();
    const started = performance.now();
    for (
      let job = next();
      job != null && performance.now() - started < SLICE;
      job = next()
    ) {
      job.isDone = true;
      try {
        job.run();
      } catch (error) {
        reportError(error);
      }
    }
    prune();
  }
  state.isDraining = false;
}

export function schedule(
  run: () => void,
  when: Strategy | ReadonlyArray<Strategy>,
) {
  const job: Job = {
    run,
    rank: Math.min(...strategiesOf(when).map((strategy) => RANKS[strategy])),
    isDone: false,
  };
  queue.push(job);
  if (!state.isDraining) {
    void drain();
  }
  return {
    hurry: () => {
      job.rank = -1;
    },
    cancel: () => {
      job.isDone = true;
    },
  };
}

function soon(start: () => void) {
  queueMicrotask(start);
  return nothing;
}

const STRATEGIES: Record<
  Strategy,
  (element: Element, start: () => void, options: Options) => () => void
> = {
  eager: (_, start) => soon(start),
  idle: (_, start) => idle(start),
  visible,
  media: matched,
  interaction: onIntent,
  never: () => nothing,
};

export function strategiesOf(when: Strategy | ReadonlyArray<Strategy>) {
  return typeof when === "string" ? [when] : [...when];
}

export function watch(
  element: Element,
  when: Strategy | ReadonlyArray<Strategy>,
  start: (fired: Strategy) => void,
  options: Options = {},
) {
  const state = { isDone: false };
  const stops: Array<() => void> = [];
  const stopAll = () => {
    for (const stop of stops.splice(0)) {
      stop();
    }
  };
  const once = (fired: Strategy) => {
    if (state.isDone) {
      return;
    }
    state.isDone = true;
    stopAll();
    start(fired);
  };
  for (const strategy of strategiesOf(when)) {
    stops.push(
      STRATEGIES[strategy](
        element,
        () => {
          once(strategy);
        },
        options,
      ),
    );
    if (state.isDone) {
      stopAll();
      break;
    }
  }
  return {
    now: () => {
      once("interaction");
    },
    stop: () => {
      state.isDone = true;
      stopAll();
    },
  };
}

const ACTIVE =
  'button, input, select, textarea, label, summary, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])';

/**
 * Presses an element again as if the reader had, for a click held before the
 * code behind it had loaded.
 *
 * @param target The element to press.
 * @param press The original click.
 */
export function replay(target: HTMLElement, press: MouseEvent): void {
  if (press.detail === 0) {
    target.click();
    return;
  }
  const { detail } = press;
  const init = {
    altKey: press.altKey,
    bubbles: true,
    button: press.button,
    cancelable: true,
    clientX: press.clientX,
    clientY: press.clientY,
    composed: true,
    ctrlKey: press.ctrlKey,
    isPrimary: true,
    metaKey: press.metaKey,
    pointerType:
      press instanceof PointerEvent && press.pointerType !== ""
        ? press.pointerType
        : matchMedia("(pointer: coarse)").matches
          ? "touch"
          : "mouse",
    shiftKey: press.shiftKey,
  };
  const fire = (type: string, extra: MouseEventInit = {}) => {
    const Kind = type.startsWith("mouse") ? MouseEvent : PointerEvent;
    return target.dispatchEvent(new Kind(type, { ...init, ...extra }));
  };
  const isCompatible = fire("pointerdown", { buttons: 1 });
  if (isCompatible) {
    fire("mousedown", { buttons: 1, detail });
  }
  fire("pointerup");
  if (isCompatible) {
    fire("mouseup", { detail });
  }
  fire("click", { detail });
}

function isNative(target: HTMLElement): boolean {
  if (target instanceof HTMLLabelElement) {
    return target.control instanceof HTMLElement && isNative(target.control);
  }
  if (target instanceof HTMLButtonElement) {
    return target.type === "submit";
  }
  if (target instanceof HTMLInputElement) {
    return target.type !== "button" && target.type !== "reset";
  }
  return (
    target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement
  );
}

type Held =
  | { kind: "press"; press: MouseEvent; target: HTMLElement }
  | { kind: "submit"; form: HTMLFormElement; submitter: HTMLElement | null };

export function intercept(element: Element, onHold: () => void) {
  let held: Held | null = null;
  const stops = [
    on(
      element,
      "click",
      (event) => {
        if (!(event instanceof MouseEvent && event.target instanceof Element)) {
          return;
        }
        const target = event.target.closest(ACTIVE);
        if (
          target instanceof HTMLElement &&
          element.contains(target) &&
          target.closest("a[href]") == null &&
          !isNative(target)
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          held = { kind: "press", press: event, target };
          onHold();
        }
      },
      { capture: true },
    ),
    on(
      element,
      "submit",
      (event) => {
        if (!(event.target instanceof HTMLFormElement)) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        const { submitter } = event as SubmitEvent;
        held = { kind: "submit", form: event.target, submitter };
        onHold();
      },
      { capture: true },
    ),
  ];
  const stop = () => {
    for (const each of stops.splice(0)) {
      each();
    }
  };
  const resend = () => {
    const last = held;
    held = null;
    if (last?.kind === "press" && last.target.isConnected) {
      replay(last.target, last.press);
    } else if (last?.kind === "submit" && last.form.isConnected) {
      last.form.requestSubmit(
        last.submitter?.isConnected === true ? last.submitter : null,
      );
    }
  };
  return {
    isHolding: () => held != null,
    release: () => {
      stop();
      resend();
    },
    stop: () => {
      stop();
      if (held?.kind === "submit") {
        resend();
      }
      held = null;
    },
  };
}

const FIELDS = "input, textarea, select";

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isField(element: Element): element is Field {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}

function checkable(field: Field) {
  return field instanceof HTMLInputElement &&
    (field.type === "checkbox" || field.type === "radio")
    ? field
    : null;
}

function isDirty(field: Field) {
  if (field instanceof HTMLSelectElement) {
    return [...field.options].some(
      (option) => option.selected !== option.defaultSelected,
    );
  }
  const box = checkable(field);
  return box == null
    ? field.value !== field.defaultValue
    : box.checked !== box.defaultChecked;
}

function snapshot(field: Field) {
  if (field instanceof HTMLSelectElement) {
    const chosen = [...field.options].map((option) => option.selected);
    return () => {
      for (const [at, option] of [...field.options].entries()) {
        option.selected = chosen[at] ?? false;
      }
    };
  }
  const box = checkable(field);
  if (box != null) {
    const { checked } = box;
    return () => {
      box.checked = checked;
    };
  }
  const { value } = field;
  const isFocused = document.activeElement === field;
  const range =
    isFocused && field.selectionStart != null
      ? [field.selectionStart, field.selectionEnd ?? field.selectionStart]
      : null;
  return () => {
    field.value = value;
    if (range != null && document.activeElement === field) {
      field.setSelectionRange(range[0] ?? 0, range[1] ?? 0);
    }
  };
}

export function keepFields(element: Element) {
  const kept: Array<{ field: Field; restore: () => void }> = [];
  for (const found of element.querySelectorAll(FIELDS)) {
    if (isField(found) && isDirty(found)) {
      kept.push({ field: found, restore: snapshot(found) });
    }
  }
  if (kept.length === 0) {
    return null;
  }
  return () => {
    for (const { field, restore } of kept) {
      if (!field.isConnected) {
        continue;
      }
      restore();
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
}
