import type { Component } from "svelte";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRawSnippet, flushSync } from "svelte";
import { compile } from "svelte/compiler";
import { render as renderServer } from "svelte/server";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Body, Wake } from "#lib/wake.js";
import { Part } from "#lib/part.js";
import { Gone } from "#lib/runtime.js";
import { awaken, codeOf, freshen, render, reveal } from "#lib/wake.js";

const fake = vi.hoisted(() => ({
  starts: [] as Array<{ when: unknown; start: (fired: string) => void }>,
  stopped: 0,
  loaded: [] as Array<string>,
  values: new Map<string, unknown>(),
  failure: null as Error | null,
  holding: false,
  release: () => {},
}));

vi.mock("#lib/runtime.js", () => {
  class Gone extends Error {}
  const value = async (part: { name: string }) => {
    fake.loaded.push(part.name);
    if (fake.failure != null) {
      throw fake.failure;
    }
    return fake.values.get(part.name);
  };
  const nothing = () => {};
  return {
    Gone,
    watch: (
      _element: Element,
      when: unknown,
      start: (fired: string) => void,
    ) => {
      if (when !== "visible" || fake.starts.length === 0) {
        fake.starts.push({ when, start });
      }
      return {
        now: () => start("eager"),
        stop: () => {
          fake.stopped++;
        },
      };
    },
    schedule: (run: () => void) => {
      run();
      return { hurry: nothing, cancel: nothing };
    },
    load: value,
    loadSoon: value,
    loadNow: () => null,
    intercept: () => ({
      isHolding: () => fake.holding,
      release: () => {
        fake.release();
      },
      stop: nothing,
    }),
    capture: () => nothing,
    keepFields: () => null,
    whenWanted: () => nothing,
    idle: () => nothing,
    prefetch: nothing,
    onIntent: () => nothing,
    partsOf: () => [],
    isFirstGone: () => true,
    isPrefetched: () => false,
    heightOf: () => 0,
  };
});

const counter: Body = createRawSnippet((rows: () => { count: number }) => ({
  render: () => `<button>${rows().count} rows</button>`,
}));

function partOf(name: string, count: number) {
  fake.values.set(name, { count });
  return new Part({ name, hash: `${name}-hash`, source: "/", bytes: 10 });
}

function wakeOf(part: Part, overrides: Partial<Wake> = {}): Wake {
  return {
    part,
    key: part.name,
    needs: [],
    hydrate: () => ["visible"],
    reveal: "visible",
    options: {},
    code: codeOf(counter, undefined),
    scope: undefined,
    context: undefined,
    prefetch: false,
    onGone: vi.fn(),
    onRelease: vi.fn(),
    ...overrides,
  };
}

const ASYNC = path.resolve("tests/unit/dom/.async-card");

async function asyncCard() {
  const card = `<script>
  const words = $derived(await new Promise((resolve) => setTimeout(() => resolve("arrived"), 10)));
  let count = $state(0);
</script>
<p>{words}</p><button type="button" onclick={() => { count++; }}>Clicked {count}</button>`;
  const snippets = `<script module>
  import Card from "./Card.TARGET.js";
  export { card };
</script>
{#snippet card()}<Card />{/snippet}`;
  const frame = await readFile(path.resolve("src/lib/frame.svelte"), "utf8");
  await mkdir(ASYNC, { recursive: true });
  for (const target of ["client", "server"] as const) {
    const write = async (name: string, source: string) => {
      const { code } = compile(
        source.replace("TARGET", () => target),
        {
          filename: `${name}.svelte`,
          generate: target,
          experimental: { async: true },
        },
      ).js;
      await writeFile(path.join(ASYNC, `${name}.${target}.js`), code);
    };
    await write("Card", card);
    await write("Snippets", snippets);
    await write("Frame", frame);
  }
  const load = async <T>(name: string) =>
    (await import(/* @vite-ignore */ path.join(ASYNC, name))) as T;
  const server = await load<{ card: Body }>("Snippets.server.js");
  const Frame = await load<{
    default: Component<{ body: Body; value: unknown }>;
  }>("Frame.server.js");
  const { body: html } = await renderServer(Frame.default, {
    props: { body: server.card, value: null },
  });
  const client = await load<{ card: Body }>("Snippets.client.js");
  return { body: client.card, html };
}

function islandWith(html: string, state: string) {
  const target = document.createElement("div");
  target.dataset.islandState = state;
  target.setAttribute("aria-busy", "true");
  target.innerHTML = html;
  document.body.append(target);
  return target;
}

function serverHtml(count: number) {
  return `<!--[--><button>${count} rows</button><!----><!--]-->`;
}

async function fire(index = 0, strategy = "visible") {
  fake.starts[index]?.start(strategy);
  await vi.waitFor(() => {
    expect(fake.loaded.length).toBeGreaterThan(0);
  });
  await Promise.resolve();
  await Promise.resolve();
  flushSync();
}

beforeEach(() => {
  fake.starts = [];
  fake.stopped = 0;
  fake.loaded = [];
  fake.values.clear();
  fake.failure = null;
  fake.holding = false;
  fake.release = () => {};
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await rm(ASYNC, { recursive: true, force: true });
});

describe("codeOf", () => {
  it("needs a snippet or a chunk", () => {
    expect(() => codeOf(undefined, undefined)).toThrow(
      /^islands_missing_children\n/u,
    );
  });

  it("loads a chunk once, and has its body afterward", async () => {
    const chunk = vi.fn(async () => ({ body: counter }));
    const code = codeOf(undefined, chunk);
    expect(code.now()).toBeNull();
    await Promise.all([code.load(), code.load()]);
    expect(chunk).toHaveBeenCalledTimes(1);
    expect(code.now()).toBe(counter);
  });
});

describe("awaken", () => {
  it("hydrates the server HTML in place once its strategy fires", async () => {
    const part = partOf("rows", 3);
    const target = islandWith(serverHtml(3), "static");
    const button = target.querySelector("button");
    const stop = awaken(target, wakeOf(part), { rouse: () => {} });
    expect(target.dataset.islandState).toBe("static");
    await fire();
    expect(target.dataset.islandState).toBe("live");
    expect(target.querySelector("button")).toBe(button);
    expect(fake.loaded).toStrictEqual(["rows"]);
    stop();
    expect(fake.stopped).toBeGreaterThan(0);
  });

  it("replays a held click only once an async component's work resolves", async () => {
    const { body, html } = await asyncCard();
    const part = partOf("card", 0);
    const target = islandWith(html, "static");
    const pressed: Array<string> = [];
    fake.holding = true;
    fake.release = () => {
      const button = target.querySelector("button");
      button?.click();
      flushSync();
      pressed.push(button?.textContent ?? "");
    };
    awaken(target, wakeOf(part, { code: codeOf(body, undefined) }), {
      rouse: () => {},
    });
    await fire();
    await vi.waitFor(() => {
      expect(pressed).toStrictEqual(["Clicked 1"]);
    });
  });

  it("leaves the server HTML alone when it's stopped before the data arrives", async () => {
    const part = partOf("rows", 3);
    const target = islandWith(serverHtml(3), "static");
    const stop = awaken(target, wakeOf(part), { rouse: () => {} });
    stop();
    await fire();
    expect(target.dataset.islandState).toBe("static");
  });

  it("asks for a reload once when its part is gone, and not for other failures", async () => {
    const part = partOf("rows", 3);
    const gone = wakeOf(part);
    fake.failure = new Gone("gone");
    awaken(islandWith(serverHtml(3), "static"), gone, { rouse: () => {} });
    await fire();
    expect(gone.onGone).toHaveBeenCalledTimes(1);
    fake.loaded = [];
    fake.starts = [];
    fake.failure = new Error("offline");
    const offline = wakeOf(part);
    awaken(islandWith(serverHtml(3), "static"), offline, { rouse: () => {} });
    await fire();
    expect(offline.onGone).not.toHaveBeenCalled();
  });
});

describe("render", () => {
  it("replaces the skeleton with the island, rendered in the browser", async () => {
    const part = partOf("rows", 5);
    const target = islandWith(`<div class="island-shell"></div>`, "client");
    render(target, wakeOf(part), { rouse: () => {} });
    await fire();
    expect(target.getHTML()).toContain("5 rows");
    expect(target.querySelector(".island-shell")).toBeNull();
    expect(target.dataset.islandState).toBe("live");
    expect(target.hasAttribute("aria-busy")).toBe(false);
  });
});

describe("reveal", () => {
  it("puts the deferred HTML in place of the skeleton, then waits to hydrate it", async () => {
    const part = partOf("rows", 2);
    const target = islandWith(`<div class="island-shell"></div>`, "deferred");
    reveal(
      target,
      { fetch: async () => serverHtml(2), now: () => null },
      wakeOf(part, { hydrate: () => ["interaction"] }),
      { rouse: () => {} },
    );
    fake.starts[0]?.start("visible");
    await vi.waitFor(() => {
      expect(target.dataset.islandState).toBe("static");
    });
    expect(target.textContent).toContain("2 rows");
    expect(target.hasAttribute("aria-busy")).toBe(false);
    expect(fake.starts.map((each) => each.when)).toStrictEqual([
      "visible",
      ["interaction"],
    ]);
  });

  it("renders in the browser when the HTML can't be fetched", async () => {
    const part = partOf("rows", 2);
    const wake = wakeOf(part);
    reveal(
      islandWith(`<div class="island-shell"></div>`, "deferred"),
      {
        fetch: async () => {
          throw new Error("offline");
        },
        now: () => null,
      },
      wake,
      { rouse: () => {} },
    );
    fake.starts[0]?.start("visible");
    await vi.waitFor(() => {
      expect(wake.onRelease).toHaveBeenCalledTimes(1);
    });
  });
});

describe("freshen", () => {
  it("places the visitor's HTML and hydrates it from the visitor's part", async () => {
    const page = partOf("cart", 0);
    const mine = partOf("cart.mine", 4);
    const target = islandWith(`<div class="island-shell"></div>`, "fresh");
    freshen(
      target,
      async () => ({
        key: "cart",
        html: serverHtml(4),
        part: mine,
        needs: null,
      }),
      wakeOf(page),
      { rouse: () => {} },
    );
    await vi.waitFor(() => {
      expect(target.dataset.islandState).toBe("static");
    });
    await fire();
    expect(fake.loaded).toStrictEqual(["cart.mine"]);
    expect(target.dataset.islandState).toBe("live");
  });

  it("falls back to the page's own values when there's nothing fresh", async () => {
    const wake = wakeOf(partOf("cart", 0));
    freshen(
      islandWith(`<div class="island-shell"></div>`, "fresh"),
      async () => null,
      wake,
      { rouse: () => {} },
    );
    await vi.waitFor(() => {
      expect(wake.onRelease).toHaveBeenCalledTimes(1);
    });
  });
});
