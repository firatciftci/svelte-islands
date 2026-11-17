import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Part } from "#lib/part.js";

const KIB = 1024;

function made(name: string, bytes: number) {
  return new Part({ name, hash: `${name}-hash`, source: "/", bytes });
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

beforeEach(() => {
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("location", { origin: "https://example.com" });
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
