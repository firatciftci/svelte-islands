import type { Strategy } from "./part.js";

/**
 * Something the library did in the browser, reported to `observe` listeners.
 *
 * - `load`: a part's data was downloaded and decoded.
 * - `markup`: a deferred island's HTML was downloaded.
 * - `hydrate`: an island became interactive. `when` is the strategy that woke it.
 * - `reveal`: content replaced a skeleton. `from` and `to` are the heights in
 *   pixels before and after, so a difference means the skeleton shifted the page.
 * - `fail`: a part or deferred HTML could not be downloaded.
 */
export type Observation =
  | {
      type: "load" | "markup";
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
    }
  | { type: "reveal"; name: string; hash: string; from: number; to: number }
  | { type: "fail"; name: string; hash: string; message: string };

const listeners = new Set<(observation: Observation) => void>();

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
  return () => {
    listeners.delete(listener);
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
