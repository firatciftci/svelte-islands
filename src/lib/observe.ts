import type { Strategy } from "./part.js";

/**
 * Something the library did in the browser, reported to `observe` listeners.
 *
 * - `load`: a part's data was downloaded and decoded. `isPrefetch` is true when
 *   it was fetched early, at low priority, because the island came near the viewport.
 * - `markup`: a deferred island's HTML was downloaded.
 * - `hydrate`: an island became interactive, with what it cost. `when` is the
 *   strategy that woke it, `duration` is how long hydration took, `delay` is
 *   the time from the first interaction with the island to it going live (or
 *   `null` if nobody interacted first), `code` is the size of the island's own
 *   code in bytes when the Vite plugin split it out (or `null`), `data` is the
 *   size of its part in characters, `html` is the size of its HTML in
 *   characters, and `isPrefetched` says whether its data was prefetched.
 * - `reveal`: content replaced a skeleton. `from` and `to` are the heights in
 *   pixels before and after, so a difference means the skeleton shifted the page.
 * - `fail`: a part or deferred HTML could not be downloaded.
 * - `prefetch`: sent when the page is hidden or the visitor moves to another
 *   page, for each part fetched early: `used` if an island read it after it
 *   arrived, `late` if an island needed it before it arrived, and `wasted` if
 *   no island read it.
 * - `frame`: a long animation frame (over 50 ms) that an island's hydration,
 *   or the click it replayed, ran in. `duration` is the frame's length,
 *   `blocking` is how long it kept the page from responding, and `islands`
 *   names each island that hydrated in it. Only browsers with the Long
 *   Animation Frames API (Chromium) send it.
 */
export type Observation =
  | {
      type: "load";
      name: string;
      hash: string;
      bytes: number;
      duration: number;
      isPrefetch: boolean;
    }
  | {
      type: "markup";
      name: string;
      hash: string;
      bytes: number;
      duration: number;
    }
  | {
      type: "hydrate";
      name: string;
      hash: string;
      when: Strategy;
      duration: number;
      delay: number | null;
      code: number | null;
      data: number;
      html: number;
      isPrefetched: boolean;
    }
  | { type: "reveal"; name: string; hash: string; from: number; to: number }
  | { type: "fail"; name: string; hash: string; message: string }
  | {
      type: "prefetch";
      parts: Array<{
        name: string;
        hash: string;
        outcome: "used" | "late" | "wasted";
      }>;
    }
  | {
      type: "frame";
      duration: number;
      blocking: number;
      islands: Array<{ name: string; hash: string }>;
    };

const listeners = new Set<(observation: Observation) => void>();
const FRAME = "long-animation-frame";
const WINDOWS = 32;
const tracking: {
  frames: PerformanceObserver | null;
  windows: Array<{ name: string; hash: string; start: number; end: number }>;
} = { frames: null, windows: [] };

function watchFrames() {
  if (
    typeof PerformanceObserver === "undefined" ||
    tracking.frames != null ||
    !PerformanceObserver.supportedEntryTypes.includes(FRAME)
  ) {
    return;
  }
  tracking.frames = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const end = entry.startTime + entry.duration;
      const islands = tracking.windows
        .filter((made) => made.start < end && made.end > entry.startTime)
        .map(({ name, hash }) => ({ name, hash }));
      if (islands.length > 0) {
        emit({
          type: "frame",
          duration: entry.duration,
          blocking:
            "blockingDuration" in entry ? Number(entry.blockingDuration) : 0,
          islands,
        });
      }
    }
  });
  tracking.frames.observe({ type: FRAME, buffered: true });
}

export function worked(name: string, hash: string, start: number) {
  if (tracking.frames == null) {
    return;
  }
  tracking.windows.push({ name, hash, start, end: performance.now() });
  if (tracking.windows.length > WINDOWS) {
    tracking.windows.shift();
  }
}

/**
 * Calls `listener` with each observation in this browser tab. The library only
 * measures heights while a listener is attached, so an app that never calls
 * this pays nothing for it.
 *
 * Send timings to your analytics from here:
 *
 * ```ts
 * observe((event) => {
 *   if (event.type === "hydrate") {
 *     report(event.name, event.duration);
 *   }
 * });
 * ```
 *
 * @param listener Called with each observation.
 * @returns A function that stops listening.
 */
export function observe(
  listener: (observation: Observation) => void,
): () => void {
  listeners.add(listener);
  watchFrames();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      tracking.frames?.disconnect();
      tracking.frames = null;
      tracking.windows = [];
    }
  };
}

export function isObserved() {
  return listeners.size > 0;
}

export function emit(observation: Observation) {
  for (const listener of listeners) {
    try {
      listener(observation);
    } catch (error) {
      reportError(error);
    }
  }
}
