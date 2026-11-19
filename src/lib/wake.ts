import type { Snippet } from "svelte";
import { flushSync, hydrate, mount, unmount } from "svelte";
import type { Fresh, Part, Strategy } from "./part.js";
import type { Options } from "./runtime.js";
import Frame from "./frame.svelte";
import { emit, isObserved } from "./observe.js";
import { quietly } from "./part.js";
import {
  capture,
  Gone,
  heightOf,
  idle,
  intercept,
  isFirstGone,
  isPrefetched,
  keepFields,
  load,
  loadNow,
  loadSoon,
  onIntent,
  partsOf,
  prefetch,
  schedule,
  watch,
  whenWanted,
} from "./runtime.js";

export type Body = Snippet<[never, never]>;

export type Chunk = () => Promise<{ body: Body; url?: string }>;

export type Code = {
  now: () => Body | null;
  load: () => Promise<Body>;
  bytes: () => number | null;
};

export type Markup = { fetch: () => Promise<string>; now: () => string | null };

export type Wake = {
  part: Part;
  key: string;
  needs: Array<Part>;
  hydrate: () => Array<Strategy>;
  reveal: Strategy;
  options: Options;
  code: Code;
  scope: unknown;
  context: Map<unknown, unknown> | undefined;
  prefetch: boolean;
  onGone: () => void;
  onRelease: () => void;
};

export type Control = { rouse: () => void };

function nothing() {}

async function when<T>(
  promise: Promise<T>,
  done: (value: T) => void,
  failed: (error: unknown) => void,
) {
  let value: T;
  try {
    value = await promise;
  } catch (error) {
    failed(error);
    return;
  }
  done(value);
}

export function codeOf(body: Body | undefined, chunk: Chunk | undefined): Code {
  if (chunk == null) {
    if (body == null) {
      throw new Error(
        "svelte-islands: an island needs a children snippet, or code from the Vite plugin.",
      );
    }
    return { now: () => body, load: async () => body, bytes: () => null };
  }
  let loaded: { body: Body; url: string | null } | null = null;
  let pending: Promise<Body> | null = null;
  const fetchBody = async () => {
    const module = await chunk();
    loaded = { body: module.body, url: module.url ?? null };
    return module.body;
  };
  return {
    now: () => loaded?.body ?? null,
    load: async () => (pending ??= fetchBody()),
    bytes: () => {
      if (loaded?.url == null) {
        return null;
      }
      const [entry] = performance.getEntriesByName(loaded.url);
      return entry instanceof PerformanceResourceTiming
        ? entry.encodedBodySize || entry.transferSize || null
        : null;
    },
  };
}

export function measurer(part: Part) {
  let before: number | null = null;
  return {
    measure: (target: HTMLElement | null) => {
      if (target != null && isObserved()) {
        before = heightOf(target);
      }
    },
    revealed: (target: HTMLElement) => {
      if (before != null && isObserved()) {
        emit({
          type: "reveal",
          name: part.name,
          hash: part.hash,
          from: before,
          to: heightOf(target),
        });
      }
      before = null;
    },
  };
}

function isNeverOnly(strategies: ReadonlyArray<Strategy>) {
  return strategies.every((strategy) => strategy === "never");
}

function arm(
  target: HTMLElement,
  strategies: ReadonlyArray<Strategy> | Strategy,
  start: (fired: Strategy) => void,
  wake: Wake,
  control: Control,
) {
  const watcher = watch(target, strategies, start, wake.options);
  control.rouse = watcher.now;
  return watcher.stop;
}

function prefetchNear(target: HTMLElement, wake: Wake) {
  const strategies = wake.hydrate();
  if (
    !wake.prefetch ||
    isNeverOnly(strategies) ||
    strategies.some(
      (strategy) => strategy === "eager" || strategy === "visible",
    )
  ) {
    return nothing;
  }
  let cancelIdle = nothing;
  const watcher = watch(
    target,
    "visible",
    () => {
      cancelIdle = idle(() => {
        prefetch([wake.part, ...wake.needs], () => {
          void quietly(wake.code.load());
        });
      });
    },
    wake.options,
  );
  return () => {
    watcher.stop();
    cancelIdle();
  };
}

async function ready(wake: Wake, fired: Strategy) {
  const get = fired === "interaction" ? loadSoon : load;
  const [value, body] = await Promise.all([
    get(wake.part),
    wake.code.load(),
    ...wake.needs.map(async (need) => get(need)),
  ]);
  return { value, body };
}

function warmOnIntent(target: HTMLElement, wake: Wake) {
  const strategies = wake.hydrate();
  if (isNeverOnly(strategies) || strategies.includes("interaction")) {
    return nothing;
  }
  return onIntent(target, () => {
    for (const part of [wake.part, ...wake.needs]) {
      void quietly(loadSoon(part));
    }
    void quietly(wake.code.load());
  });
}

function reportHydrate(
  target: HTMLElement,
  wake: Wake,
  fired: Strategy,
  started: number,
  touched: number | null,
) {
  if (!isObserved()) {
    return;
  }
  const now = performance.now();
  emit({
    type: "hydrate",
    name: wake.part.name,
    hash: wake.part.hash,
    when: fired,
    duration: now - started,
    delay: touched == null ? null : now - touched,
    code: wake.code.bytes(),
    data: wake.part.bytes,
    html: target.getHTML().length,
    isPrefetched: isPrefetched(wake.part),
  });
}

/** Hydrates server HTML that's already in place once a strategy fires. */
export function awaken(target: HTMLElement, wake: Wake, control: Control) {
  const isNever = isNeverOnly(wake.hydrate());
  let job: ReturnType<typeof schedule> | null = null;
  let touched: number | null = null;
  const held = isNever
    ? null
    : intercept(target, () => {
        touched ??= performance.now();
        control.rouse();
        job?.hurry();
      });
  const stopCapture = capture(wake.key, target);
  let instance: ReturnType<typeof hydrate> | null = null;
  let isLive = true;
  let stopWanting = nothing;
  let stopPrefetch = nothing;
  const go = (value: unknown, body: Body, fired: Strategy) => {
    if (!isLive || instance != null) {
      return;
    }
    stopWanting();
    stopPrefetch();
    const restore = keepFields(target);
    const started = performance.now();
    instance = hydrate(Frame, {
      target,
      props: { body, value, scope: wake.scope },
      context: wake.context,
    });
    target.dataset.islandState = "live";
    if (restore != null) {
      flushSync();
      restore();
    }
    reportHydrate(target, wake, fired, started, touched);
    if (held?.isHolding() === true) {
      flushSync();
    }
    held?.release();
  };
  const stop = arm(
    target,
    wake.hydrate(),
    (fired) => {
      if (fired === "interaction") {
        touched ??= performance.now();
      }
      void when(
        ready(wake, fired),
        ({ value, body }) => {
          if (!isLive) {
            return;
          }
          job = schedule(() => {
            go(value, body, fired);
          }, wake.hydrate());
          if (fired === "interaction" || held?.isHolding() === true) {
            job.hurry();
          }
        },
        (error) => {
          held?.stop();
          if (isLive && error instanceof Gone && isFirstGone(wake.part.hash)) {
            wake.onGone();
          }
        },
      );
    },
    wake,
    control,
  );
  const stopPrefetchNear = prefetchNear(target, wake);
  const stopWarming = warmOnIntent(target, wake);
  stopPrefetch = () => {
    stopPrefetchNear();
    stopWarming();
  };
  if (!isNever) {
    stopWanting = whenWanted((want) => {
      if (want === "find") {
        control.rouse();
        return;
      }
      const body = wake.code.now();
      const found = body == null ? null : loadNow(wake.part);
      if (
        body != null &&
        found != null &&
        wake.needs.every((need) => loadNow(need) != null)
      ) {
        stop();
        job?.cancel();
        go(found.value, body, "eager");
        flushSync();
      }
    });
  }
  return () => {
    isLive = false;
    job?.cancel();
    stop();
    stopPrefetch();
    stopWanting();
    stopCapture();
    held?.stop();
    if (instance != null) {
      void unmount(instance);
    }
  };
}

function place(
  target: HTMLElement,
  html: string,
  meter: ReturnType<typeof measurer>,
) {
  const skeleton = target.querySelector(":scope > .island-shell");
  if (skeleton == null) {
    return false;
  }
  meter.measure(target);
  const template = document.createElement("template");
  template.innerHTML = html;
  target.querySelector(":scope > .island-outline")?.remove();
  skeleton.replaceWith(template.content);
  target.dataset.islandState = "static";
  target.removeAttribute("aria-busy");
  meter.revealed(target);
  return true;
}

/** Brings in HTML kept out of the page, then hydrates it like server HTML. */
export function reveal(
  target: HTMLElement,
  markup: Markup,
  wake: Wake,
  control: Control,
) {
  const meter = measurer(wake.part);
  let isLive = true;
  let rest = nothing;
  let stopWanting = nothing;
  const show = (html: string) => {
    if (!isLive || target.querySelector(":scope > .island-shell") == null) {
      return;
    }
    stopWanting();
    place(target, html, meter);
    rest = awaken(target, wake, control);
  };
  const stop = arm(
    target,
    wake.reveal,
    () => {
      if (
        wake
          .hydrate()
          .some((strategy) => strategy === "eager" || strategy === "visible")
      ) {
        void quietly(load(wake.part));
        void quietly(wake.code.load());
      }
      void when(markup.fetch(), show, () => {
        if (isLive) {
          wake.onRelease();
        }
      });
    },
    wake,
    control,
  );
  stopWanting = whenWanted((want) => {
    if (want === "find") {
      control.rouse();
      return;
    }
    const html = markup.now();
    if (html != null) {
      stop();
      show(html);
    }
  });
  return () => {
    isLive = false;
    stop();
    stopWanting();
    rest();
  };
}

/**
 * Brings in an island rendered on the server for this visitor, then hydrates
 * it with the value it was rendered from.
 */
export function freshen(
  target: HTMLElement,
  fresh: () => Promise<Fresh | null>,
  wake: Wake,
  control: Control,
) {
  const meter = measurer(wake.part);
  let isLive = true;
  let rest = nothing;
  void when(
    fresh(),
    (found) => {
      if (!isLive) {
        return;
      }
      if (found == null || !place(target, found.html, meter)) {
        wake.onRelease();
        return;
      }
      rest = awaken(
        target,
        { ...wake, part: found.part, needs: partsOf(found.needs) },
        control,
      );
    },
    () => {
      if (isLive) {
        wake.onRelease();
      }
    },
  );
  return () => {
    isLive = false;
    rest();
  };
}

/** Renders an island in the browser in place of its skeleton, without a parent component. */
export function render(target: HTMLElement, wake: Wake, control: Control) {
  const meter = measurer(wake.part);
  let instance: ReturnType<typeof mount> | null = null;
  let isLive = true;
  let job: ReturnType<typeof schedule> | null = null;
  const stopCapture = capture(wake.key, target);
  const stop = arm(
    target,
    wake.hydrate(),
    (fired) => {
      void when(
        ready(wake, fired),
        ({ value, body }) => {
          if (!isLive) {
            return;
          }
          job = schedule(() => {
            if (!isLive || instance != null) {
              return;
            }
            meter.measure(target);
            const started = performance.now();
            target.replaceChildren();
            instance = mount(Frame, {
              target,
              props: { body, value, scope: wake.scope },
              context: wake.context,
            });
            flushSync();
            target.dataset.islandState = "live";
            target.removeAttribute("aria-busy");
            meter.revealed(target);
            reportHydrate(target, wake, fired, started, null);
          }, wake.hydrate());
        },
        (error) => {
          if (isLive && error instanceof Gone && isFirstGone(wake.part.hash)) {
            wake.onGone();
          }
        },
      );
    },
    wake,
    control,
  );
  return () => {
    isLive = false;
    job?.cancel();
    stop();
    stopCapture();
    if (instance != null) {
      void unmount(instance);
    }
  };
}
