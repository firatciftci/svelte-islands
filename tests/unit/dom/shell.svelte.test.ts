import { createRawSnippet, flushSync } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Body, Wake } from "#lib/wake.js";
import { Part, serialize } from "#lib/part.js";
import { start } from "#lib/shell.svelte.js";

const fake = vi.hoisted(() => ({
  calls: [] as Array<{ mode: string; target: HTMLElement; wake: Wake }>,
}));

vi.mock("#lib/wake.js", () => {
  const record =
    (mode: string) =>
    (target: HTMLElement, ...rest: Array<unknown>) => {
      const wake = rest.find(
        (each): each is Wake =>
          typeof each === "object" && each != null && "part" in each,
      );
      if (wake != null) {
        fake.calls.push({ mode, target, wake });
      }
      return () => {};
    };
  return {
    awaken: record("awaken"),
    freshen: record("freshen"),
    reveal: record("reveal"),
    render: record("render"),
    codeOf: (_: unknown, chunk: () => Promise<unknown>) => ({
      now: () => null,
      load: chunk,
      bytes: () => null,
    }),
  };
});

vi.mock("#lib/runtime.js", () => ({
  freshOf: async () => null,
  holdSwaps: () => {},
  markupNow: () => null,
  markupOf: async () => "",
  partsOf: () => [],
}));

const body: Body = createRawSnippet(() => ({ render: () => "<p></p>" }));

async function load() {
  return { body };
}

function partOf(name: string) {
  return new Part({
    name,
    hash: `${name}-hash-0000000000`.slice(0, 22),
    source: "/",
    bytes: 10,
    isPrivate: true,
    loaded: { value: [] },
  });
}

type Scope = { at: number | null; names: Array<string>; own: object } | null;

function sentOf(part: Part, module: string, state: string, scope: Scope) {
  return {
    part,
    key: part.name,
    state,
    file: state === "deferred" ? "deferred.html" : null,
    needs: null,
    module,
    hydrate: null,
    reveal: "visible",
    margin: null,
    media: null,
    prefetch: true,
    scope,
    context: [[false, "tone", "warm"]],
  };
}

function page(
  islands: Array<ReturnType<typeof sentOf>>,
  scopes: Array<Record<string, unknown>> = [],
  modules = islands.map((island) => island.module),
) {
  const elements = islands
    .map(
      (island, index) =>
        `<div data-island="${island.part.hash}" data-island-module="${modules[index] ?? ""}" data-island-state="${island.state}"></div>`,
    )
    .join("");
  document.body.innerHTML = `${elements}<script type="application/json" id="svelte-islands">${serialize({ scopes, islands }, true)}</script>`;
}

beforeEach(() => {
  fake.calls = [];
  document.body.replaceChildren();
});

describe("the island boot", () => {
  it("starts each island the way its state says", () => {
    page([
      sentOf(partOf("a"), "m1", "static", null),
      sentOf(partOf("b"), "m2", "deferred", null),
      sentOf(partOf("c"), "m3", "fresh", null),
      sentOf(partOf("d"), "m4", "client", null),
    ]);
    start(load);
    expect(fake.calls.map((call) => call.mode)).toStrictEqual([
      "awaken",
      "reveal",
      "freshen",
      "render",
    ]);
    expect(fake.calls[0]?.wake.hydrate()).toStrictEqual(["interaction"]);
    expect(fake.calls[3]?.wake.hydrate()).toStrictEqual(["visible"]);
    expect(fake.calls[0]?.wake.context?.get("tone")).toBe("warm");
  });

  it("skips an element whose module doesn't match what was sent", () => {
    page([sentOf(partOf("a"), "m1", "static", null)], [], ["other"]);
    start(load);
    expect(fake.calls).toStrictEqual([]);
  });

  it("renders in the browser when a deferred or fresh island gives up", () => {
    page([sentOf(partOf("a"), "m1", "deferred", null)]);
    start(load);
    fake.calls[0]?.wake.onRelease();
    expect(fake.calls.map((call) => call.mode)).toStrictEqual([
      "reveal",
      "render",
    ]);
  });

  it("gives a component's islands one live copy of the page values, and keeps their own apart", () => {
    page(
      [
        sentOf(partOf("a"), "m1", "static", {
          at: 0,
          names: ["count"],
          own: { item: "first" },
        }),
        sentOf(partOf("b"), "m2", "static", {
          at: 0,
          names: ["count"],
          own: { item: "second" },
        }),
      ],
      [{ count: 2 }],
    );
    start(load);
    const [first, second] = fake.calls.map(
      (call) => call.wake.scope as { count: number; item: string },
    );
    const seen: Array<number | undefined> = [];
    const stop = $effect.root(() => {
      $effect(() => {
        seen.push(second?.count);
      });
    });
    flushSync();
    if (first != null) {
      first.count = 5;
      first.item = "changed";
    }
    flushSync();
    stop();
    expect(seen).toStrictEqual([2, 5]);
    expect(second?.item).toBe("second");
    expect(first?.item).toBe("changed");
  });
});
