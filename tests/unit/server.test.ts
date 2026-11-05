import type { RequestEvent } from "@sveltejs/kit";
import { brotliDecompressSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ServerModule from "#lib/server.js";
import type { Store } from "#lib/server.js";

type Server = typeof ServerModule;

const ORIGIN = "https://site.test";

function memoryStore() {
  const held = new Map<string, string>();
  const store: Store = {
    get: async (key) => held.get(key) ?? null,
    set: async (key, text) => held.set(key, text),
  };
  return { held, store };
}

function eventFor(
  path: string,
  {
    headers = {},
    method = "GET",
    fetcher = async () => new Response("{}"),
  }: {
    headers?: Record<string, string>;
    method?: string;
    fetcher?: (target: URL, init: RequestInit) => Promise<Response>;
  } = {},
) {
  const url = new URL(path, ORIGIN);
  return {
    url,
    locals: {},
    isDataRequest: false,
    request: new Request(url, { method, headers }),
    fetch: async (target: URL, init: RequestInit) => fetcher(target, init),
    cookies: { get: () => {}, getAll: () => [] },
  } as unknown as RequestEvent;
}

describe("the part server", () => {
  let server: Server;
  let enter: (event: RequestEvent) => void;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("$app/env", () => ({ dev: false, building: false }));
    server = await import("#lib/server.js");
    ({ enter } = await import("../stubs/server.js"));
  });

  async function serve(
    event: RequestEvent,
    handler: ReturnType<Server["handle"]>,
  ) {
    return handler({ event, resolve: async () => new Response("page") });
  }

  function publish(value: unknown, options?: Parameters<Server["part"]>[2]) {
    enter(eventFor("/page"));
    return server.part("thing", value, options);
  }

  const large = { rows: "x".repeat(8000) };

  it("serves a part it made, immutably", async () => {
    const handler = server.handle();
    const made = publish(large);
    const response = await serve(eventFor(`/_parts/${made.hash}`), handler);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("etag")).toBe(`"${made.hash}"`);
    expect(await response.text()).toContain("xxx");
  });

  it("answers 304 to a matching validator, compressed or not", async () => {
    const handler = server.handle();
    const made = publish(large);
    for (const etag of [`"${made.hash}"`, `"${made.hash}-br"`]) {
      const response = await serve(
        eventFor(`/_parts/${made.hash}`, {
          headers: { "if-none-match": etag },
        }),
        handler,
      );
      expect(response.status).toBe(304);
    }
  });

  it("compresses with Brotli when the browser accepts it", async () => {
    const handler = server.handle();
    const made = publish(large);
    const event = eventFor(`/_parts/${made.hash}`, {
      headers: { "accept-encoding": "gzip, br" },
    });
    const response = await serve(event, handler);
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(response.headers.get("vary")).toBe("accept-encoding");
    expect(response.headers.get("etag")).toBe(`"${made.hash}-br"`);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBeLessThan(200);
    expect(brotliDecompressSync(body).toString()).toContain("xxx");
  });

  it("leaves small parts and other browsers uncompressed", async () => {
    const handler = server.handle();
    const small = publish({ a: 1 });
    const big = publish(large);
    const asks = [
      eventFor(`/_parts/${small.hash}`, {
        headers: { "accept-encoding": "br" },
      }),
      eventFor(`/_parts/${big.hash}`, {
        headers: { "accept-encoding": "gzip" },
      }),
    ];
    for (const event of asks) {
      const response = await serve(event, handler);
      expect(response.headers.has("content-encoding")).toBe(false);
    }
  });

  it("can turn compression off", async () => {
    const handler = server.handle({ compress: false });
    const made = publish(large);
    const response = await serve(
      eventFor(`/_parts/${made.hash}`, {
        headers: { "accept-encoding": "br" },
      }),
      handler,
    );
    expect(response.headers.has("content-encoding")).toBe(false);
  });

  it.each([
    ["a bad name", "/_parts/nope"],
    ["a dotted name", "/_parts/aaaaaaaaaaaaaaaaaaaaaa.js"],
    ["a slash", "/_parts/aaaaaaaaaaaaaaaaaaaaaa/x"],
  ])("answers 404 to %s", async (_, path) => {
    const handler = server.handle();
    const fetcher = vi.fn(async () => new Response("{}"));
    const response = await serve(eventFor(path, { fetcher }), handler);
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses to write", async () => {
    const handler = server.handle();
    const made = publish(large);
    const response = await serve(
      eventFor(`/_parts/${made.hash}`, { method: "POST" }),
      handler,
    );
    expect(response.status).toBe(404);
  });

  it("answers an unknown part with 404 and no-store", async () => {
    const handler = server.handle();
    const response = await serve(
      eventFor(`/_parts/${"a".repeat(22)}`),
      handler,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  describe("recovering a missing part", () => {
    const missing = "a".repeat(22);

    it.each([
      ["another site", "https://evil.test/"],
      ["a protocol-relative URL", "//evil.test/"],
      ["a backslash", String.raw`/\evil.test`],
      ["a backslash after a slash", String.raw`/\/evil.test`],
      ["a tab in the host", "/\t/evil.test"],
      ["a relative path", "page"],
      ["its own prefix", "/_parts/abc"],
      ["a walk back into its prefix", "/x/../_parts/abc"],
      ["a dot segment before its prefix", "/./_parts/abc"],
      ["an encoded dot segment", "/%2e/_parts/abc"],
      ["a walk out and back in", "/_parts/../_parts/abc"],
    ])("refuses %s, for data and for HTML", async (_, source) => {
      const handler = server.handle();
      for (const file of [missing, `${missing}.html`]) {
        const fetcher = vi.fn(async (_target: URL) => new Response("{}"));
        const response = await serve(
          eventFor(`/_parts/${file}?u=${encodeURIComponent(source)}`, {
            fetcher,
          }),
          handler,
        );
        const asked = fetcher.mock.calls.map(([target]) => target.href);
        expect(asked.filter((url) => !url.startsWith(ORIGIN))).toStrictEqual(
          [],
        );
        expect(asked.filter((url) => url.includes("/_parts/"))).toStrictEqual(
          [],
        );
        expect(response.status).toBe(404);
      }
    });

    it("reruns the page's data and returns the part it makes", async () => {
      const handler = server.handle();
      const value = { rows: "y".repeat(8000) };
      enter(eventFor("/probe"));
      const { hash } = server.part("thing", value);
      vi.resetModules();
      server = await import("#lib/server.js");
      ({ enter } = await import("../stubs/server.js"));
      const fresh = server.handle();
      expect(handler).not.toBe(fresh);
      const fetcher = vi.fn(async (target: URL, init: RequestInit) => {
        enter(
          eventFor(target.href, {
            headers: Object.fromEntries(new Headers(init.headers)),
          }),
        );
        server.part("thing", value);
        return new Response("{}");
      });
      const response = await serve(
        eventFor(`/_parts/${hash}?u=${encodeURIComponent("/page?x=1")}`, {
          fetcher,
        }),
        fresh,
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("yyy");
      expect(String(fetcher.mock.calls[0]?.[0])).toBe(
        `${ORIGIN}/page/__data.json?x=1`,
      );
    });

    it("shares one run and then stops rerunning for misses", async () => {
      const handler = server.handle();
      const fetcher = vi.fn(async () => new Response("{}"));
      const event = () => eventFor(`/_parts/${missing}?u=/page`, { fetcher });
      const responses = await Promise.all([
        serve(event(), handler),
        serve(event(), handler),
        serve(event(), handler),
      ]);
      expect(responses.map(({ status }) => status)).toStrictEqual([
        404, 404, 404,
      ]);
      expect((await serve(event(), handler)).status).toBe(404);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("keeps different languages apart", async () => {
      const handler = server.handle();
      const fetcher = vi.fn(async () => new Response("{}"));
      for (const language of ["en", "fr", "en"]) {
        await serve(
          eventFor(`/_parts/${missing}?u=/page`, {
            fetcher,
            headers: { "accept-language": language },
          }),
          handler,
        );
      }
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("answers 503 with retry-after when too many are waiting", async () => {
      const handler = server.handle({ rebuild: { concurrency: 1, queue: 0 } });
      let open = () => {};
      const fetcher = vi.fn(
        async () =>
          new Promise<Response>((resolve) => {
            open = () => {
              resolve(new Response("{}"));
            };
          }),
      );
      const first = serve(
        eventFor(`/_parts/${missing}?u=/a`, { fetcher }),
        handler,
      );
      await vi.waitFor(() => {
        expect(fetcher).toHaveBeenCalled();
      });
      const second = await serve(
        eventFor(`/_parts/${missing}?u=/b`, { fetcher }),
        handler,
      );
      expect(second.status).toBe(503);
      expect(second.headers.get("retry-after")).toBe("1");
      expect(second.headers.get("cache-control")).toBe("no-store");
      open();
      await first;
    });

    it("answers 503 when a rerun takes too long", async () => {
      const handler = server.handle({ rebuild: { timeout: 5 } });
      const response = await serve(
        eventFor(`/_parts/${missing}?u=/a`, {
          fetcher: async () => new Promise<Response>(() => {}),
        }),
        handler,
      );
      expect(response.status).toBe(503);
    });

    it("can be turned off", async () => {
      const handler = server.handle({ rebuild: false });
      const fetcher = vi.fn(async () => new Response("{}"));
      const response = await serve(
        eventFor(`/_parts/${missing}?u=/a`, { fetcher }),
        handler,
      );
      expect(response.status).toBe(404);
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  describe("private parts", () => {
    const secret = { token: "s3cret-token", rows: "z".repeat(8000) };

    it("never reach the store or a public URL", async () => {
      const { held, store } = memoryStore();
      const handler = server.handle({ store });
      const made = publish(secret, { private: true });
      await Promise.resolve();
      expect(held.values().toArray().join("")).not.toContain("s3cret-token");
      const response = await serve(eventFor(`/_parts/${made.hash}`), handler);
      expect(response.status).toBe(404);
    });

    it("stay inline however large they are", () => {
      server.handle();
      const made = publish(secret, { private: true });
      expect(made.isPrivate).toBe(true);
      expect(made.isInline).toBe(true);
      expect(made.loaded?.value).toBe(secret);
    });

    it("are not collected by a rebuild", async () => {
      const handler = server.handle();
      const made = publish(secret, { private: true });
      const fetcher = vi.fn(async (target: URL, init: RequestInit) => {
        enter(
          eventFor(target.href, {
            headers: Object.fromEntries(new Headers(init.headers)),
          }),
        );
        server.part("thing", secret, { private: true });
        return new Response("{}");
      });
      const response = await serve(
        eventFor(`/_parts/${made.hash}?u=/page`, { fetcher }),
        handler,
      );
      expect(response.status).toBe(404);
    });

    it("add no preload link", async () => {
      const event = eventFor("/page");
      enter(event);
      const handler = server.handle();
      server.part("thing", secret, { private: true, fetch: "preload" });
      let transformed = "";
      await handler({
        event,
        resolve: async (_, options) => {
          transformed =
            (await options?.transformPageChunk?.({
              html: "<head></head>",
              done: true,
            })) ?? "";
          return new Response(transformed);
        },
      });
      expect(transformed).toBe("<head></head>");
    });

    it("cannot hide inside a public part", () => {
      server.handle();
      const inner = publish(secret, { private: true });
      expect(() => publish({ inner })).toThrow(/private part/u);
    });
  });

  describe("the warning about per-visitor data", () => {
    async function developing() {
      vi.resetModules();
      vi.doMock("$app/env", () => ({ dev: true, building: false }));
      server = await import("#lib/server.js");
      ({ enter } = await import("../stubs/server.js"));
      return vi.spyOn(console, "warn").mockImplementation(() => {});
    }

    async function visit(
      handler: ReturnType<Server["handle"]>,
      load: (event: RequestEvent) => void,
    ) {
      const event = eventFor("/page");
      enter(event);
      await handler({
        event,
        resolve: async (inner) => {
          load(inner);
          return new Response("page");
        },
      });
    }

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("warns once per part when a public part follows a cookie read", async () => {
      const warn = await developing();
      const handler = server.handle();
      const load = (event: RequestEvent) => {
        event.cookies.get("session");
        server.part("account", large);
      };
      await visit(handler, load);
      await visit(handler, load);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('part("account")');
    });

    it("stays quiet for private parts and pages without cookies", async () => {
      const warn = await developing();
      const handler = server.handle();
      await visit(handler, (event) => {
        event.cookies.get("session");
        server.part("account", large, { private: true });
      });
      await visit(handler, () => {
        server.part("public", large);
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it("can be silenced", async () => {
      const warn = await developing();
      const handler = server.handle({ warnOnCookies: false });
      await visit(handler, (event) => {
        event.cookies.get("session");
        server.part("account", large);
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it("stays out of production", async () => {
      vi.resetModules();
      vi.doMock("$app/env", () => ({ dev: false, building: false }));
      server = await import("#lib/server.js");
      ({ enter } = await import("../stubs/server.js"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const handler = server.handle();
      await visit(handler, (event) => {
        event.cookies.get("session");
        server.part("account", large);
      });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it("writes public parts to the store, once each", async () => {
    const { held, store } = memoryStore();
    server.handle({ store });
    const set = vi.spyOn(store, "set");
    const made = publish(large);
    publish(large);
    await Promise.resolve();
    expect(held.get(`p:${made.hash}`)).toContain("xxx");
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("reads a part from the store after memory forgets it", async () => {
    const { held, store } = memoryStore();
    held.set(`p:${"b".repeat(22)}`, "stored");
    const handler = server.handle({ store });
    const response = await serve(
      eventFor(`/_parts/${"b".repeat(22)}`),
      handler,
    );
    expect(await response.text()).toBe("stored");
  });

  it("survives a store that fails", async () => {
    const handler = server.handle({
      store: {
        get: async () => {
          throw new Error("down");
        },
        set: async () => {
          throw new Error("down");
        },
      },
    });
    const made = publish(large);
    const response = await serve(eventFor(`/_parts/${made.hash}`), handler);
    expect(response.status).toBe(200);
    const unknown = await serve(eventFor(`/_parts/${"c".repeat(22)}`), handler);
    expect(unknown.status).toBe(404);
  });

  it("drops the oldest parts past its memory budget", async () => {
    const handler = server.handle({ memory: 10_000 });
    const first = publish({ rows: "a".repeat(6000) });
    const second = publish({ rows: "b".repeat(6000) });
    expect(
      (await serve(eventFor(`/_parts/${first.hash}`), handler)).status,
    ).toBe(404);
    expect(
      (await serve(eventFor(`/_parts/${second.hash}`), handler)).status,
    ).toBe(200);
  });

  it("passes every other request through", async () => {
    const handler = server.handle();
    const response = await serve(eventFor("/page"), handler);
    expect(await response.text()).toBe("page");
  });

  it("adds a preload link for parts that ask for one", async () => {
    const event = eventFor("/page");
    enter(event);
    const handler = server.handle();
    const made = server.part("thing", large, { fetch: "preload" });
    let transformed = "";
    await handler({
      event,
      resolve: async (_, options) => {
        transformed =
          (await options?.transformPageChunk?.({
            html: "<head></head>",
            done: true,
          })) ?? "";
        return new Response(transformed);
      },
    });
    expect(transformed).toContain(`href="/_parts/${made.hash}"`);
    expect(transformed).toContain('rel="preload"');
  });
});
