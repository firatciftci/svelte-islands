import { afterEach, describe, expect, it, vi } from "vitest";
import type { Observation } from "#lib/observe.js";
import { emit, isObserved, observe } from "#lib/observe.js";

const event: Observation = {
  type: "load",
  name: "rows",
  hash: "abc",
  bytes: 10,
  duration: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("observe", () => {
  it("reports to each listener until it unsubscribes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = observe(first);
    const stopSecond = observe(second);
    expect(isObserved()).toBe(true);
    emit(event);
    stopFirst();
    emit(event);
    stopSecond();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    expect(isObserved()).toBe(false);
  });

  it("a listener that throws does not stop the others", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const failure = new Error("listener");
    const stopBad = observe(() => {
      throw failure;
    });
    const good = vi.fn();
    const stopGood = observe(good);
    emit(event);
    stopBad();
    stopGood();
    expect(good).toHaveBeenCalledWith(event);
    expect(reportError).toHaveBeenCalledWith(failure);
  });
});
