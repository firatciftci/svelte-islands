import type { RequestEvent } from "@sveltejs/kit";
import { brotliDecompressSync } from "node:zlib";
import type { Snippet } from "svelte";
import { createRawSnippet } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as PartModule from "#lib/part.js";
import type * as ServerModule from "#lib/server.js";
import type { Store } from "#lib/server.js";

function raw(html: string): Snippet<[never]> {
  return createRawSnippet(() => ({ render: () => html }));
}

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
    const response = await serve(
      eventFor(`/_parts/${made.hash}.json`),
      handler,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(response.headers.get("etag")).toBe(`"${made.hash}.json"`);
    expect(await response.text()).toContain("xxx");
  });

  it("answers tabs left open from before file names ended in .json", async () => {
    const handler = server.handle();
    const made = publish(large);
    const part = await serve(eventFor(`/_parts/${made.hash}`), handler);
    expect(part.status).toBe(200);
    expect(await part.text()).toContain("xxx");
    const shapes = await serve(eventFor("/_parts/skeletons"), handler);
    expect(shapes.status).toBe(200);
  });

  it("answers 304 to a matching validator, compressed or not", async () => {
    const handler = server.handle();
    const made = publish(large);
    for (const etag of [`"${made.hash}.json"`, `"${made.hash}.json-br"`]) {
      const response = await serve(
        eventFor(`/_parts/${made.hash}.json`, {
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
    const event = eventFor(`/_parts/${made.hash}.json`, {
      headers: { "accept-encoding": "gzip, br" },
    });
    const response = await serve(event, handler);
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(response.headers.get("vary")).toBe("accept-encoding");
    expect(response.headers.get("etag")).toBe(`"${made.hash}.json-br"`);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body.length).toBeLessThan(200);
    expect(brotliDecompressSync(body).toString()).toContain("xxx");
  });

  it("leaves small parts and other browsers uncompressed", async () => {
    const handler = server.handle();
    const small = publish({ a: 1 });
    const big = publish(large);
    const asks = [
      eventFor(`/_parts/${small.hash}.json`, {
        headers: { "accept-encoding": "br" },
      }),
      eventFor(`/_parts/${big.hash}.json`, {
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
      eventFor(`/_parts/${made.hash}.json`, {
        headers: { "accept-encoding": "br" },
      }),
      handler,
    );
    expect(response.headers.has("content-encoding")).toBe(false);
  });

  it.each([
    ["a bad name", "/_parts/nope"],
    ["a name with no extension", "/_parts/aaaaaaaaaaaaaaaaaaaaaa"],
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
      eventFor(`/_parts/${made.hash}.json`, { method: "POST" }),
      handler,
    );
    expect(response.status).toBe(404);
  });

  it("answers an unknown part with 404 and no-store", async () => {
    const handler = server.handle();
    const response = await serve(
      eventFor(`/_parts/${"a".repeat(22)}.json`),
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
      for (const file of [`${missing}.json`, `${missing}.html`]) {
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
        eventFor(`/_parts/${hash}.json?u=${encodeURIComponent("/page?x=1")}`, {
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
      const event = () =>
        eventFor(`/_parts/${missing}.json?u=/page`, { fetcher });
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

    function rerunMaking(values: Array<unknown>) {
      return vi.fn(async (target: URL, init: RequestInit) => {
        enter(
          eventFor(target.href, {
            headers: Object.fromEntries(new Headers(init.headers)),
          }),
        );
        for (const value of values) {
          server.part("thing", value);
        }
        return new Response("{}");
      });
    }

    async function forgotten(values: Array<unknown>) {
      server.handle();
      enter(eventFor("/probe"));
      const hashes = values.map((value) => server.part("thing", value).hash);
      vi.resetModules();
      server = await import("#lib/server.js");
      ({ enter } = await import("../stubs/server.js"));
      return { handler: server.handle(), hashes };
    }

    it("publishes only the part it was asked for when the visitor sent cookies", async () => {
      const values = [{ rows: "a".repeat(8000) }, { rows: "b".repeat(8000) }];
      const { handler, hashes } = await forgotten(values);
      const [asked, sibling] = hashes;
      const fetcher = rerunMaking(values);
      const recovered = await serve(
        eventFor(`/_parts/${asked}.json?u=/page`, {
          fetcher,
          headers: { cookie: "session=ada" },
        }),
        handler,
      );
      expect(recovered.status).toBe(200);
      const again = await serve(eventFor(`/_parts/${asked}.json`), handler);
      expect(again.status).toBe(200);
      const other = await serve(eventFor(`/_parts/${sibling}.json`), handler);
      expect(other.status).toBe(404);
    });

    it("publishes every part it made when the visitor sent no cookies", async () => {
      const values = [{ rows: "a".repeat(8000) }, { rows: "b".repeat(8000) }];
      const { handler, hashes } = await forgotten(values);
      const [asked, sibling] = hashes;
      const fetcher = rerunMaking(values);
      await serve(
        eventFor(`/_parts/${asked}.json?u=/page`, { fetcher }),
        handler,
      );
      const other = await serve(eventFor(`/_parts/${sibling}.json`), handler);
      expect(other.status).toBe(200);
    });

    it("runs at most its concurrency under a flood of random names", async () => {
      const handler = server.handle();
      let running = 0;
      let most = 0;
      const fetcher = vi.fn(async () => {
        running++;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return new Response("{}");
      });
      const responses = await Promise.all(
        Array.from({ length: 200 }, async (_, index) =>
          serve(
            eventFor(
              `/_parts/${String(index).padStart(22, "x")}.json?u=/page/${index}`,
              { fetcher },
            ),
            handler,
          ),
        ),
      );
      const statuses = responses.map(({ status }) => status);
      expect(most).toBe(4);
      expect(fetcher).toHaveBeenCalledTimes(36);
      expect(statuses.filter((status) => status === 503)).toHaveLength(164);
      expect(statuses.filter((status) => status === 404)).toHaveLength(36);
    });

    it("keeps different languages apart", async () => {
      const handler = server.handle();
      const fetcher = vi.fn(async () => new Response("{}"));
      for (const language of ["en", "fr", "en"]) {
        await serve(
          eventFor(`/_parts/${missing}.json?u=/page`, {
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
        eventFor(`/_parts/${missing}.json?u=/a`, { fetcher }),
        handler,
      );
      await vi.waitFor(() => {
        expect(fetcher).toHaveBeenCalled();
      });
      const second = await serve(
        eventFor(`/_parts/${missing}.json?u=/b`, { fetcher }),
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
        eventFor(`/_parts/${missing}.json?u=/a`, {
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
        eventFor(`/_parts/${missing}.json?u=/a`, { fetcher }),
        handler,
      );
      expect(response.status).toBe(404);
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  describe("eager parts", () => {
    function made(
      isDataRequest: boolean,
      options?: Parameters<Server["part"]>[2],
    ) {
      const event = eventFor("/page");
      enter({ ...event, isDataRequest });
      return server.part("thing", { rows: "x".repeat(8000) }, options);
    }

    it("starts loading auto parts as soon as a data request arrives", () => {
      expect(made(true).isEager).toBe(true);
    });

    it("leaves auto parts to the island on a full page load", () => {
      expect(made(false).isEager).toBe(false);
    });

    it("always starts preload parts", () => {
      expect(made(false, { fetch: "preload" }).isEager).toBe(true);
    });

    it("never starts lazy parts", () => {
      expect(made(true, { fetch: "lazy" }).isEager).toBe(false);
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
      const response = await serve(
        eventFor(`/_parts/${made.hash}.json`),
        handler,
      );
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
        eventFor(`/_parts/${made.hash}.json?u=/page`, { fetcher }),
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

  describe("waiting for the store", () => {
    function slowStore() {
      const finished: Array<string> = [];
      const { promise, resolve: finish } = Promise.withResolvers<void>();
      const store: Store = {
        get: async () => null,
        set: async (key) => {
          await promise;
          finished.push(key);
        },
      };
      return { finished, store, finish };
    }

    async function pageWith(
      event: RequestEvent,
      handler: ReturnType<Server["handle"]>,
    ) {
      enter(event);
      return handler({
        event,
        resolve: async () => {
          server.part("big", "x".repeat(5000));
          return new Response("page");
        },
      });
    }

    it("holds the response until new parts are stored", async () => {
      const { finished, store, finish } = slowStore();
      const handler = server.handle({ store });
      const response = pageWith(eventFor("/page"), handler);
      let isDone = false;
      void response.then(() => {
        isDone = true;
      });
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      expect(isDone).toBe(false);
      finish();
      await response;
      expect(finished).toHaveLength(1);
    });

    it("answers anyway when the store is too slow", async () => {
      const { store } = slowStore();
      const started = Date.now();
      await pageWith(eventFor("/page"), server.handle({ store }));
      expect(Date.now() - started).toBeGreaterThanOrEqual(900);
      expect(Date.now() - started).toBeLessThan(3000);
    });

    it("uses waitUntil where the platform has it", async () => {
      const { store } = slowStore();
      const kept: Array<Promise<unknown>> = [];
      const event = eventFor("/page");
      Object.assign(event, {
        platform: {
          ctx: {
            waitUntil: (work: Promise<unknown>) => {
              kept.push(work);
            },
          },
        },
      });
      await pageWith(event, server.handle({ store }));
      expect(kept).toHaveLength(1);
    });

    it("doesn't wait when nothing new was made", async () => {
      const { store, finish } = slowStore();
      const handler = server.handle({ store });
      const first = pageWith(eventFor("/page"), handler);
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      finish();
      await first;
      const started = Date.now();
      await pageWith(eventFor("/page"), handler);
      expect(Date.now() - started).toBeLessThan(200);
    });
  });

  it("reads a part from the store after memory forgets it", async () => {
    const { held, store } = memoryStore();
    held.set(`p:${"b".repeat(22)}`, "stored");
    const handler = server.handle({ store });
    const response = await serve(
      eventFor(`/_parts/${"b".repeat(22)}.json`),
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
    const response = await serve(
      eventFor(`/_parts/${made.hash}.json`),
      handler,
    );
    expect(response.status).toBe(200);
    const unknown = await serve(
      eventFor(`/_parts/${"c".repeat(22)}.json`),
      handler,
    );
    expect(unknown.status).toBe(404);
  });

  it("drops the oldest parts past its memory budget", async () => {
    const handler = server.handle({ memory: 10_000 });
    const first = publish({ rows: "a".repeat(6000) });
    const second = publish({ rows: "b".repeat(6000) });
    expect(
      (await serve(eventFor(`/_parts/${first.hash}.json`), handler)).status,
    ).toBe(404);
    expect(
      (await serve(eventFor(`/_parts/${second.hash}.json`), handler)).status,
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
    expect(transformed).toContain(`href="/_parts/${made.hash}.json"`);
    expect(transformed).toContain('rel="preload"');
  });
});

describe("pages without SvelteKit's client", () => {
  const KIT = "<script>__sveltekit_abc = { base: '' };</script>";
  let server: Server;
  let part: typeof PartModule;
  let enter: (event: RequestEvent) => void;

  async function load(isDev: boolean) {
    vi.resetModules();
    vi.doMock("$app/env", () => ({ dev: isDev, building: false }));
    server = await import("#lib/server.js");
    part = await import("#lib/part.js");
    ({ enter } = await import("../stubs/server.js"));
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    await load(false);
  });

  function record(scope: object | null, context = new Map<unknown, unknown>()) {
    const made = server.part("shell", { rows: "x".repeat(8000) });
    part
      .scope()
      ?.adopt({
        part: made,
        key: "shell",
        render: "server",
        as: "div",
        body: raw("<p>shell</p>"),
        className: null,
        why: null,
        module: "abc123",
        hydrate: null,
        reveal: "visible",
        margin: null,
        media: null,
        prefetch: true,
        scope,
        context,
      });
    return made;
  }

  async function page(
    handler: ReturnType<Server["handle"]>,
    html: string,
    fill: () => void = () => {},
  ) {
    const event = eventFor("/page");
    enter(event);
    fill();
    let transformed = "";
    await handler({
      event,
      resolve: async (_, options) => {
        transformed =
          (await options?.transformPageChunk?.({ html, done: true })) ?? "";
        return new Response(transformed);
      },
    });
    return transformed;
  }

  function sent(html: string) {
    const text =
      /<script type="application\/json" id="svelte-islands">(.*?)<\/script>/u.exec(
        html,
      )?.[1];
    return text == null
      ? null
      : (part.deserialize(text) as Array<{
          module: string;
          scope: Record<string, unknown> | null;
          context: Array<[boolean, string, unknown]>;
        }>);
  }

  it("get the boot script, each island's values, and its named contexts but not SvelteKit's", async () => {
    const handler = server.handle();
    const html = await page(handler, "<head></head><body></body>", () => {
      record(
        { count: 2, when: new Date(0) },
        new Map<unknown, unknown>([
          ["__request__", { page: { data: { secret: "page data" } } }],
          ["label", "warm"],
          [Symbol.for("tone"), "dry"],
          [Symbol("hidden"), "secret"],
          ["helper", () => {}],
        ]),
      );
    });
    expect(html).toContain(
      '<link rel="modulepreload" href="/_app/islands.js">',
    );
    expect(html).toContain('<link rel="modulepreload" href="/_app/shared.js">');
    expect(html).toContain(
      '<script type="module" src="/_app/islands.js"></script></body>',
    );
    const [island] = sent(html) ?? [];
    expect(island?.module).toBe("abc123");
    expect(island?.scope).toStrictEqual({ count: 2, when: new Date(0) });
    expect(island?.context).toStrictEqual([
      [false, "label", "warm"],
      [true, "tone", "dry"],
    ]);
  });

  it("escape the island data so it can't close its script", async () => {
    const handler = server.handle();
    const html = await page(handler, "<head></head><body></body>", () => {
      record({ text: "</script><script>alert(1)</script>" });
    });
    expect(html.match(/<\/script>/gu)?.length).toBe(2);
    expect(sent(html)?.[0]?.scope).toStrictEqual({
      text: "</script><script>alert(1)</script>",
    });
  });

  it("leave pages with SvelteKit's client alone", async () => {
    const handler = server.handle({ speculation: "prerender" });
    const html = await page(handler, `<head></head><body>${KIT}</body>`, () => {
      record({ count: 2 });
    });
    expect(sent(html)).toBeNull();
    expect(html).not.toContain("speculationrules");
  });

  it("throw in development when an island reads a function from the page", async () => {
    await load(true);
    const handler = server.handle();
    await expect(
      page(handler, "<head></head><body></body>", () => {
        record({ shout: () => "" });
      }),
    ).rejects.toThrow(/reads `shout` from the page, and it holds a function/u);
  });

  it("leave such an island as server HTML in production", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = server.handle();
    const html = await page(handler, "<head></head><body></body>", () => {
      record({ shout: () => "" });
    });
    expect(sent(html)).toBeNull();
    expect(logged).toHaveBeenCalledOnce();
  });

  it("get speculation rules when asked, and every page gets view transitions", async () => {
    const handler = server.handle({
      speculation: "prefetch",
      viewTransitions: true,
    });
    const shell = await page(handler, "<head></head><body></body>");
    expect(shell).toContain('<script type="speculationrules">{"prefetch":');
    expect(shell).toContain("[data-sveltekit-preload-data='false']");
    expect(shell).toContain("@view-transition");
    const routed = await page(handler, `<head></head><body>${KIT}</body>`);
    expect(routed).not.toContain("speculationrules");
    expect(routed).toContain("@view-transition");
  });

  it("make fresh parts from the fallback, without reading, outside a fresh request", async () => {
    server.handle();
    enter(eventFor("/page"));
    const read = vi.fn(() => ({ name: "Ada" }));
    const made = await server.fresh("visitor", read, { name: "guest" });
    expect(read).not.toHaveBeenCalled();
    expect(made.loaded?.value).toStrictEqual({ name: "guest" });
    expect(made.isPrivate).toBe(false);
  });

  it("leaves the query out of a part's page, so no token lands in the markup", () => {
    server.handle();
    enter(eventFor("/reset?token=secret&utm_source=mail"));
    const made = server.part("thing", { rows: "x".repeat(8000) });
    expect(made.source).toBe("/reset");
  });

  it("warns once in production when fresh islands can't render, however many pages fail", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = server.handle();
    for (const page of ["/one", "/two", "/three"]) {
      await handler({
        event: eventFor(`/_parts/fresh?u=${page}`, {
          fetcher: async () => new Response(null, { status: 500 }),
        }),
        resolve: async () => new Response("page"),
      });
    }
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("doesn't warn when a fresh request names a page that doesn't exist", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = server.handle();
    const response = await handler({
      event: eventFor("/_parts/fresh?u=/nowhere", {
        fetcher: async () => new Response(null, { status: 404 }),
      }),
      resolve: async () => new Response("page"),
    });
    expect(response.status).toBe(502);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  function freshRender(islands: number) {
    return vi.fn(async (target: URL, init: RequestInit) => {
      enter(
        eventFor(target.href, {
          headers: Object.fromEntries(new Headers(init.headers)),
        }),
      );
      for (let index = 0; index < islands; index++) {
        part
          .scope()
          ?.adopt({
            part: server.part("cart", { items: 2 }),
            key: `cart-${index}`,
            render: "fresh",
            as: "div",
            body: raw("<p>2 items</p>"),
            className: null,
            why: null,
            module: null,
            hydrate: null,
            reveal: "visible",
            margin: null,
            media: null,
            prefetch: true,
            scope: null,
            context: new Map(),
          });
      }
      return new Response("page");
    });
  }

  async function askFresh(
    handler: ReturnType<Server["handle"]>,
    page: string,
    fetcher: ReturnType<typeof freshRender>,
  ) {
    return handler({
      event: eventFor(`/_parts/fresh?u=${page}`, { fetcher }),
      resolve: async () => new Response("page"),
    });
  }

  it("stop rendering a page for fresh requests once it showed no fresh islands", async () => {
    const handler = server.handle();
    const fetcher = freshRender(0);
    expect((await askFresh(handler, "/about", fetcher)).status).toBe(200);
    expect((await askFresh(handler, "/about", fetcher)).status).toBe(404);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keep answering a page that has fresh islands, even when the queue is full", async () => {
    const handler = server.handle({ rebuild: { concurrency: 1, queue: 0 } });
    const cart = freshRender(1);
    expect((await askFresh(handler, "/shop", cart)).status).toBe(200);
    let open = () => {};
    const stuck = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          open = () => {
            resolve(new Response("page"));
          };
        }),
    );
    const waiting = askFresh(handler, "/unknown", stuck);
    await vi.waitFor(() => {
      expect(stuck).toHaveBeenCalled();
    });
    expect((await askFresh(handler, "/other", freshRender(0))).status).toBe(
      503,
    );
    const known = await askFresh(handler, "/shop", cart);
    expect(known.status).toBe(200);
    expect(await known.text()).toContain("2 items");
    open();
    await waiting;
  });

  it("render at most the rebuild concurrency for a flood of unknown pages", async () => {
    const handler = server.handle();
    let running = 0;
    let most = 0;
    const fetcher = vi.fn(async () => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return new Response("page");
    });
    const responses = await Promise.all(
      Array.from({ length: 200 }, async (_, index) =>
        askFresh(handler, `/flood/${index}`, fetcher),
      ),
    );
    const statuses = responses.map(({ status }) => status);
    expect(most).toBe(4);
    expect(fetcher).toHaveBeenCalledTimes(36);
    expect(statuses.filter((status) => status === 503)).toHaveLength(164);
    expect(
      responses.every(
        ({ headers }) => headers.get("cache-control") === "private, no-store",
      ),
    ).toBe(true);
  });

  it("answer a fresh request for a page outside the site with 404", async () => {
    const handler = server.handle();
    const response = await handler({
      event: eventFor("/_parts/fresh?u=https://elsewhere.test/"),
      resolve: async () => new Response("page"),
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
