import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isWithinBudget, measure, parseBudget, run } from "#lib/budget.js";

function output() {
  const lines: { out: Array<string>; err: Array<string> } = {
    out: [],
    err: [],
  };
  return {
    lines,
    io: {
      out: (line: string) => {
        lines.out.push(line);
      },
      err: (line: string) => {
        lines.err.push(line);
      },
    },
  };
}

function page(size: number) {
  return async () => new Response("x".repeat(size));
}

describe("measure", () => {
  it("counts raw bytes, not characters", () => {
    expect(measure(new TextEncoder().encode("é☃")).raw).toBe(5);
  });

  it("counts only inline scripts", () => {
    const html = `<script src="/a.js"></script><script>abcd</script><SCRIPT type="application/json">ef
gh</SCRIPT><p>text</p>`;
    expect(measure(new TextEncoder().encode(html)).inline).toBe(9);
  });

  it("measures gzip", () => {
    const { raw, gzip } = measure(new TextEncoder().encode("a".repeat(10_000)));
    expect(raw).toBe(10_000);
    expect(gzip).toBeLessThan(100);
  });
});

describe("parseBudget", () => {
  it("accepts a budget", () => {
    expect(
      parseBudget('{"limits":{"raw":1},"pages":{"/":{},"/a":{"gzip":2}}}'),
    ).toEqual({ limits: { raw: 1 }, pages: { "/": {}, "/a": { gzip: 2 } } });
  });

  it.each([
    ["no pages", "{}", "pages"],
    ["pages as a list", '{"pages":[]}', "pages"],
    ["a relative path", '{"pages":{"a":{}}}', "slash"],
    ["an unknown limit", '{"pages":{"/":{"brotli":1}}}', "brotli"],
    ["a limit of zero", '{"limits":{"raw":0},"pages":{}}', "positive"],
    ["a limit as text", '{"limits":{"raw":"1"},"pages":{}}', "positive"],
  ])("rejects %s", (_name, text, message) => {
    expect(() => parseBudget(text)).toThrow(message);
  });
});

describe("isWithinBudget", () => {
  it("passes pages within their limits", async () => {
    const { lines, io } = output();
    const isFine = await isWithinBudget(
      "https://site.test/",
      { limits: { raw: 2 }, pages: { "/": {} } },
      io,
      page(2048),
    );
    expect(isFine).toBe(true);
    expect(lines.out[0]).toContain("raw 2 KiB of 2 KiB");
  });

  it("fails a page over a limit and names it", async () => {
    const { lines, io } = output();
    const isFine = await isWithinBudget(
      "https://site.test",
      { limits: { raw: 1 }, pages: { "/big": {} } },
      io,
      page(2049),
    );
    expect(isFine).toBe(false);
    expect(lines.err[0]).toContain("/big: raw 2 KiB is over 1 KiB");
  });

  it("lets a page set its own limit", async () => {
    const { io } = output();
    expect(
      await isWithinBudget(
        "https://site.test",
        { limits: { raw: 1 }, pages: { "/big": { raw: 3 } } },
        io,
        page(2049),
      ),
    ).toBe(true);
  });

  it("joins the origin and path, and asks for the uncompressed page", async () => {
    const asked: Array<[string, RequestInit]> = [];
    const { io } = output();
    await isWithinBudget(
      "https://site.test///",
      { limits: {}, pages: { "/a?b=c": {} } },
      io,
      async (url, init) => {
        asked.push([url, init]);
        return new Response("x");
      },
    );
    expect(asked[0]?.[0]).toBe("https://site.test/a?b=c");
    expect(asked[0]?.[1].headers).toEqual({ "accept-encoding": "identity" });
  });

  it("retries once, then fails", async () => {
    let calls = 0;
    const { lines, io } = output();
    const budget = { limits: {}, pages: { "/": {} } };
    const flaky = async () => {
      calls += 1;
      return calls === 1
        ? new Response(null, { status: 503 })
        : new Response("x");
    };
    expect(await isWithinBudget("https://site.test", budget, io, flaky)).toBe(
      true,
    );
    expect(calls).toBe(2);
    expect(
      await isWithinBudget("https://site.test", budget, io, async () => {
        throw new Error("refused");
      }),
    ).toBe(false);
    expect(lines.err[0]).toContain("failed: /: refused");
  });

  it("keeps checking after one page fails", async () => {
    const seen: Array<string> = [];
    const { io } = output();
    await isWithinBudget(
      "https://site.test",
      { limits: {}, pages: { "/a": {}, "/b": {} } },
      io,
      async (url) => {
        seen.push(url);
        return new Response(null, { status: url.endsWith("/a") ? 500 : 200 });
      },
    );
    expect(seen.at(-1)).toBe("https://site.test/b");
  });
});

describe("the command", () => {
  let directory = "";
  let config = "";

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "islands-budget-"));
    config = join(directory, "budget.json");
    await writeFile(config, '{"limits":{"raw":1},"pages":{"/":{}}}');
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("exits 0 within budget", async () => {
    const { io } = output();
    expect(
      await run(
        ["check", "https://site.test", "--config", config],
        io,
        page(1),
      ),
    ).toBe(0);
  });

  it("exits 1 over budget", async () => {
    const { io } = output();
    expect(
      await run(["check", "https://site.test", "-c", config], io, page(2000)),
    ).toBe(1);
  });

  it.each([
    ["no command", []],
    ["another command", ["build"]],
    ["no url", ["check"]],
    ["a bad url", ["check", "not a url"]],
    ["an unknown flag", ["check", "https://site.test", "--dry"]],
    ["a missing file", ["check", "https://site.test", "-c", "/missing.json"]],
  ])("exits 2 for %s", async (_name, args) => {
    const { lines, io } = output();
    expect(await run(args, io, page(1))).toBe(2);
    expect(lines.err.length).toBeGreaterThan(0);
  });

  it("prints usage for --help", async () => {
    const { lines, io } = output();
    expect(await run(["--help"], io, page(1))).toBe(0);
    expect(lines.out[0]).toContain("Usage: svelte-islands check");
  });
});
