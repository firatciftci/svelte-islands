import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Part } from "#lib/part.js";

const KIB = 1024;

function made(name: string, bytes: number, source = "/") {
  return new Part({ name, hash: `${name}-hash`, source, bytes });
}

async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function fresh() {
  vi.resetModules();
  return import("#lib/runtime.js");
}

function stubFetch() {
  const calls: Array<{ url: string; priority: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init?: RequestInit) => {
      calls.push({ url: url.href, priority: init?.priority });
      return new Promise<Response>(() => {});
    }),
  );
  return calls;
}

const listeners = new Map<string, Array<(event: Event) => void>>();

beforeEach(() => {
  listeners.clear();
  vi.stubGlobal(
    "addEventListener",
    (type: string, listener: (event: Event) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  );
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("location", {
    origin: "https://example.com",
    pathname: "/",
    search: "",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("strategiesOf", () => {
  it("takes one strategy or several", async () => {
    const { strategiesOf } = await fresh();
    expect(strategiesOf("idle")).toStrictEqual(["idle"]);
    expect(strategiesOf(["interaction", "idle"])).toStrictEqual([
      "interaction",
      "idle",
    ]);
  });
});

describe("loading on intent", () => {
  it("asks at high priority", async () => {
    const calls = stubFetch();
    const { loadSoon } = await fresh();
    void loadSoon(made("rows", KIB));
    await settled();
    expect(calls[0]?.priority).toBe("high");
  });

  it("runs once for each island the event happens inside", async () => {
    const { onIntent } = await fresh();
    const outer = { parentElement: null };
    const inner = { parentElement: outer };
    vi.stubGlobal("Element", Object);
    const ran: Array<string> = [];
    const stop = onIntent(outer as unknown as Element, () => {
      ran.push("outer");
    });
    onIntent(inner as unknown as Element, () => {
      ran.push("inner");
    });
    const pointerOver = listeners.get("pointerover") ?? [];
    for (const listener of pointerOver) {
      listener({ target: inner } as unknown as Event);
    }
    stop();
    const focusIn = listeners.get("focusin") ?? [];
    for (const listener of focusIn) {
      listener({ target: inner } as unknown as Event);
    }
    expect(ran).toStrictEqual(["inner", "outer", "inner"]);
  });
});

describe("the prefetch summary", () => {
  it("reports each prefetched part as used, late, or wasted when the page hides", async () => {
    const { prefetch, load } = await fresh();
    const { observe } = await import("#lib/observe.js");
    const { serialize } = await import("#lib/part.js");
    const arrived = made("arrived", KIB);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) =>
        url.href.includes("arrived")
          ? new Response(serialize([1]))
          : new Promise<Response>(() => {}),
      ),
    );
    const seen: Array<unknown> = [];
    observe((event) => {
      if (event.type === "prefetch") {
        seen.push(event.parts.map((part) => [part.name, part.outcome]));
      }
    });
    prefetch([arrived, made("late", KIB), made("wasted", KIB)], () => {});
    await settled();
    await load(arrived);
    void load(made("late", KIB));
    const pageHide = listeners.get("pagehide") ?? [];
    for (const listener of pageHide) {
      listener(new Event("pagehide"));
    }
    expect(seen).toStrictEqual([
      [
        ["arrived", "used"],
        ["late", "late"],
        ["wasted", "wasted"],
      ],
    ]);
  });
});

describe("prefetch", () => {
  it("fetches at low priority and runs the extra work", async () => {
    const calls = stubFetch();
    const { isPrefetched, prefetch } = await fresh();
    const rows = made("rows", 10 * KIB);
    const extra = vi.fn();
    prefetch([rows], extra);
    await settled();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.priority).toBe("low");
    expect(extra).toHaveBeenCalledOnce();
    expect(isPrefetched(rows)).toBe(true);
  });

  it("stops at the page budget", async () => {
    const calls = stubFetch();
    const { prefetch } = await fresh();
    const extra = vi.fn();
    prefetch([made("first", 600 * KIB)], extra);
    prefetch([made("second", 600 * KIB)], extra);
    prefetch([made("third", 100 * KIB)], extra);
    await settled();
    expect(calls).toHaveLength(2);
    expect(extra).toHaveBeenCalledTimes(2);
  });

  it("gives each page its own budget", async () => {
    const calls = stubFetch();
    const { prefetch } = await fresh();
    const extra = vi.fn();
    prefetch([made("first", 900 * KIB)], extra);
    prefetch([made("second", 900 * KIB)], extra);
    vi.stubGlobal("location", {
      origin: "https://example.com",
      pathname: "/next",
      search: "",
    });
    prefetch([made("third", 900 * KIB)], extra);
    await settled();
    expect(calls).toHaveLength(2);
    expect(extra).toHaveBeenCalledTimes(2);
  });

  it("asks once for a part that's already on its way", async () => {
    const calls = stubFetch();
    const { load, prefetch } = await fresh();
    const rows = made("rows", 10 * KIB);
    void load(rows);
    prefetch([rows], () => {});
    await settled();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.priority).toBe("auto");
  });

  it.each([
    ["Save-Data", { saveData: true }],
    ["a 2G connection", { effectiveType: "2g" }],
    ["a slow 2G connection", { effectiveType: "slow-2g" }],
  ])("skips everything on %s", async (_, connection) => {
    vi.stubGlobal("navigator", { connection });
    const calls = stubFetch();
    const { prefetch } = await fresh();
    const extra = vi.fn();
    prefetch([made("rows", KIB)], extra);
    await settled();
    expect(calls).toHaveLength(0);
    expect(extra).not.toHaveBeenCalled();
  });
});

describe("rebuilding a missing part", () => {
  function missing() {
    const asked: Array<URL> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        asked.push(new URL(url));
        return new Response(null, { status: 404 });
      }),
    );
    return asked;
  }

  it("sends the page's own query, which the page's markup leaves out", async () => {
    vi.stubGlobal("location", {
      origin: "https://example.com",
      pathname: "/search",
      search: "?q=boats",
    });
    const asked = missing();
    const { load } = await fresh();
    await expect(load(made("results", KIB, "/search"))).rejects.toThrow();
    expect(asked.at(-1)?.searchParams.get("u")).toBe("/search?q=boats");
  });

  it("sends only the path for a part from another page", async () => {
    vi.stubGlobal("location", {
      origin: "https://example.com",
      pathname: "/search",
      search: "?q=boats",
    });
    const asked = missing();
    const { load } = await fresh();
    await expect(load(made("menu", KIB, "/"))).rejects.toThrow();
    expect(asked.at(-1)?.searchParams.get("u")).toBe("/");
  });
});
