import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serveParts } from "#lib/sw.js";

const ORIGIN = "https://example.com";

class FakeCache {
  entries = new Map<string, Response>();

  async keys() {
    return this.entries.keys().toArray();
  }

  async delete(key: string) {
    return this.entries.delete(key);
  }

  async put(key: string, response: Response) {
    this.entries.delete(key);
    this.entries.set(key, response);
  }

  async match(key: string) {
    return this.entries.get(key)?.clone();
  }
}

const stores = new Map<string, FakeCache>();
const network = vi.fn<(request: Request) => Promise<Response>>();

function open(name: string) {
  const found = stores.get(name) ?? new FakeCache();
  stores.set(name, found);
  return found;
}

function serve(
  path: string,
  options?: Parameters<typeof serveParts>[1],
  method = "GET",
) {
  const pending: Array<Promise<unknown>> = [];
  let answer: Promise<Response> | null = null;
  const isHandled = serveParts(
    {
      request: new Request(new URL(path, ORIGIN), { method }),
      respondWith(response) {
        answer = response;
      },
      waitUntil(work) {
        pending.push(work);
      },
    },
    options,
  );
  return {
    isHandled,
    answer: () => answer,
    async settled() {
      await answer;
      await Promise.all(pending);
    },
  };
}

beforeEach(() => {
  stores.clear();
  network.mockReset();
  vi.stubGlobal("location", { origin: ORIGIN });
  vi.stubGlobal("caches", { open: async (name: string) => open(name) });
  vi.stubGlobal("fetch", network);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("serveParts", () => {
  it("leaves other paths, other origins, and other methods alone", () => {
    expect(serve("/page").isHandled).toBe(false);
    expect(serve("https://cdn.example.org/_parts/abc").isHandled).toBe(false);
    expect(serve("/_parts/abc", undefined, "POST").isHandled).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });

  it("downloads a part once and answers from the cache after that", async () => {
    network.mockImplementation(async () => new Response("first"));
    const first = serve("/_parts/abc");
    expect(first.isHandled).toBe(true);
    await first.settled();
    expect(await (await first.answer())?.text()).toBe("first");

    network.mockImplementation(async () => new Response("second"));
    const second = serve("/_parts/abc");
    await second.settled();
    expect(await (await second.answer())?.text()).toBe("first");
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("treats a part's source query as the same part", async () => {
    network.mockImplementation(async () => new Response("rows"));
    await serve("/_parts/abc?u=/page").settled();
    await serve("/_parts/abc").settled();
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failed response", async () => {
    network.mockImplementation(
      async () => new Response("gone", { status: 404 }),
    );
    const missing = serve("/_parts/abc");
    await missing.settled();
    expect((await missing.answer())?.status).toBe(404);
    expect(open("svelte-islands-parts").entries.size).toBe(0);
  });

  it("rejects when the part was never stored and the network is down", async () => {
    network.mockRejectedValue(new TypeError("offline"));
    await expect(serve("/_parts/abc").answer()).rejects.toThrow("offline");
  });

  it("prefers the network for skeletons, and falls back to the cache", async () => {
    network.mockImplementation(async () => new Response("old"));
    await serve("/_parts/skeletons.json").settled();

    network.mockImplementation(async () => new Response("new"));
    const fresh = serve("/_parts/skeletons.json");
    await fresh.settled();
    expect(await (await fresh.answer())?.text()).toBe("new");

    network.mockRejectedValue(new TypeError("offline"));
    const offline = serve("/_parts/skeletons.json");
    await offline.settled();
    expect(await (await offline.answer())?.text()).toBe("new");
  });

  it("keeps only the newest responses up to the limit", async () => {
    network.mockImplementation(async () => new Response("rows"));
    for (const hash of ["a", "b", "c", "d"]) {
      await serve(`/_parts/${hash}`, { limit: 2 }).settled();
    }
    expect(open("svelte-islands-parts").entries.keys().toArray()).toEqual([
      "/_parts/c",
      "/_parts/d",
    ]);
  });

  it("uses the prefix and cache name it was given", async () => {
    network.mockImplementation(async () => new Response("rows"));
    const options = { prefix: "/base/_parts/", cache: "mine" };
    expect(serve("/_parts/abc", options).isHandled).toBe(false);
    await serve("/base/_parts/abc", options).settled();
    expect(open("mine").entries.keys().toArray()).toEqual(["/base/_parts/abc"]);
  });
});
