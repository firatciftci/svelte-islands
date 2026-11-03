import { on } from "svelte/events";
import { SvelteSet } from "svelte/reactivity";
import type { Part, Strategy } from "./part.js";
import { deserialize, onArrival, quietly, settings } from "./part.js";
import { shape } from "./skeleton.js";

const BUDGET = 64 * 1024 ** 2;
const MARGIN = "320px";
const DELAYS = [1000, 3000, 5000];
const SCRIPT = "svelte-islands-skeletons";
const INTERACTIONS = ["pointerenter", "pointerdown", "focusin", "touchstart"];

export class Gone extends Error {}

const values = new Map<string, { value: unknown; bytes: number }>();
const arrived = new SvelteSet<string>();
const pending = new Map<string, Promise<unknown>>();
const skeletons = new Map<string, string>();
const claimed = new WeakSet<Element>();
const refreshed = new Set<string>();
const watched = new Map<Element, Set<() => void>>();
const observers = new Map<string, IntersectionObserver>();
const state: { held: number; isBooted: boolean; isRead: boolean } = {
  held: 0,
  isBooted: false,
  isRead: false,
};

export type Options = { margin?: string; media?: string };

export type Claimed = {
  state: "static" | "deferred" | "client";
  file: string | null;
};

function nothing() {}

function keep(hash: string, value: unknown, bytes: number) {
  values.set(hash, { value, bytes });
  arrived.add(hash);
  state.held += bytes;
  for (const [oldest, kept] of values) {
    if (oldest === hash || state.held <= BUDGET) {
      break;
    }
    values.delete(oldest);
    arrived.delete(oldest);
    state.held -= kept.bytes;
  }
}

export function peek<T>(part: Part<T>): { value: T } | null {
  if (part.loaded != null) {
    return part.loaded;
  }
  const found = arrived.has(part.hash) ? values.get(part.hash) : null;
  if (found == null) {
    return null;
  }
  values.delete(part.hash);
  values.set(part.hash, found);
  return { value: found.value as T };
}

async function fetched(name: string, source: string) {
  const url = new URL(`${settings.prefix}${name}`, location.origin);
  const response = await fetch(url);
  if (response.ok) {
    return response.text();
  }
  if (response.status !== 404) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  url.searchParams.set("u", source);
  const rebuilt = await fetch(url);
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

export async function markupOf(file: string, source: string) {
  return persist(async () => fetched(file, source));
}

async function request(part: Part) {
  try {
    const value = deserialize(
      await persist(async () => fetched(part.hash, part.source)),
    );
    keep(part.hash, value, part.bytes);
    return value;
  } finally {
    pending.delete(part.hash);
  }
}

export async function load<T>(part: Part<T>): Promise<T> {
  const known = peek(part);
  if (known != null) {
    return known.value;
  }
  let found = pending.get(part.hash);
  if (found == null) {
    found = request(part);
    pending.set(part.hash, found);
  }
  return (await found) as T;
}

onArrival((part) => {
  const learned = Object.entries(part.skeletons ?? {});
  for (const [key, html] of learned) {
    skeletons.set(key, html);
  }
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

export function boot() {
  state.isBooted = true;
}

const CLAIMABLE: ReadonlySet<string> = new Set([
  "static",
  "deferred",
  "client",
]);

function isClaimable(value: string | undefined): value is Claimed["state"] {
  return value != null && CLAIMABLE.has(value);
}

export function claim(part: Part, key: string): Claimed | null {
  if (typeof document === "undefined" || state.isBooted) {
    return null;
  }
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
      const skeleton = element.querySelector(":scope > .island-skeleton");
      if (found !== "static" && skeleton != null && !skeletons.has(key)) {
        skeletons.set(key, skeleton.getHTML());
      }
      return { state: found, file: element.dataset.islandFile ?? null };
    }
  }
  return null;
}

function read() {
  if (typeof document === "undefined" || state.isRead) {
    return;
  }
  state.isRead = true;
  const text = document.querySelector(`#${SCRIPT}`)?.textContent;
  if (text == null) {
    return;
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed == null) {
    return;
  }
  for (const [name, html] of Object.entries(parsed)) {
    if (typeof html === "string" && !skeletons.has(name)) {
      skeletons.set(name, html);
    }
  }
}

export function skeletonOf(key: string) {
  read();
  return skeletons.get(key) ?? null;
}

const WIDTHS = [48, 41, 45, 33, 47, 38, 29, 44];

export function fallback(bytes: number) {
  const lines = Math.min(12, Math.max(3, Math.round(Math.log2(bytes / 512))));
  return Array.from(
    { length: lines },
    (_, at) =>
      `<span class="island-bone island-line" style="--n:${WIDTHS[at % WIDTHS.length] ?? 40}"></span>`,
  ).join("");
}

function idle(run: () => void) {
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

export function capture(key: string, element: Element) {
  read();
  if (skeletons.has(key)) {
    return nothing;
  }
  return idle(() => {
    const shaped = shape(element);
    if (shaped != null && shaped !== "" && !skeletons.has(key)) {
      skeletons.set(key, shaped);
    }
  });
}

function boxes(element: Element): Array<Element> {
  return getComputedStyle(element).display === "contents"
    ? [...element.children].flatMap((child) => boxes(child))
    : [element];
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

function engaged(element: Element, start: () => void) {
  const stops = INTERACTIONS.map((type) =>
    on(element, type, start, { passive: true, capture: true }),
  );
  return () => {
    for (const stop of stops) {
      stop();
    }
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
  interaction: engaged,
  never: () => nothing,
};

export function watch(
  element: Element,
  when: Strategy,
  start: () => void,
  options: Options = {},
) {
  let isDone = false;
  let stop = nothing;
  const once = () => {
    if (isDone) {
      return;
    }
    isDone = true;
    stop();
    start();
  };
  stop = STRATEGIES[when](element, once, options);
  return () => {
    isDone = true;
    stop();
  };
}

const ACTIVE =
  'button, input, select, textarea, label, summary, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])';

export function intercept(element: Element) {
  let held: HTMLElement | null = null;
  const stop = on(
    element,
    "click",
    (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const target = event.target.closest(ACTIVE);
      if (
        target instanceof HTMLElement &&
        element.contains(target) &&
        target.closest("a[href]") == null
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        held = target;
      }
    },
    { capture: true },
  );
  return {
    release: () => {
      stop();
      const target = held;
      held = null;
      if (target?.isConnected === true) {
        target.click();
      }
    },
    stop,
  };
}
