import type { Buffer } from "node:buffer";
import { stringify } from "devalue";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { serve } from "#lib/mcp.js";

type Message = {
  id: number | null;
  result?: {
    tools?: Array<{ name: string }>;
    serverInfo?: { version: string };
    content?: Array<{ text: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string };
};

class Shipped {
  readonly head: Array<unknown>;

  constructor(head: Array<unknown>) {
    this.head = head;
  }
}

function unpacked(text: string) {
  return JSON.parse(text) as Array<unknown>;
}

const ROWS = Array.from({ length: 400 }, (_, id) => ({
  id,
  name: `row ${id}`,
}));

const PAGE = `<!doctype html><html><head></head><body>
<div class="island" data-island="aaaaaaaaaaaaaaaaaaaaaa" data-island-name="counter" data-island-why="it reads count, which can change"><button>0</button></div>
<div class="island" data-island="bbbbbbbbbbbbbbbbbbbbbb" data-island-name="list" data-island-why="inferred"><ul></ul></div>
<script>__sveltekit_x = { base: "" };</script>
</body></html>`;

const DATA = JSON.stringify({
  type: "data",
  nodes: [
    { type: "data", data: unpacked(stringify({ title: "Products" })) },
    {
      type: "data",
      data: unpacked(
        stringify(
          {
            rows: ROWS,
            products: new Shipped(["products", "c".repeat(22), "/", 9000, 0]),
          },
          { part: (value) => value instanceof Shipped && value.head },
        ),
      ),
    },
  ],
});

async function site(url: string) {
  const { pathname } = new URL(url);
  if (pathname === "/products") {
    return new Response(PAGE);
  }
  if (pathname === "/products/__data.json") {
    return new Response(DATA);
  }
  return new Response(null, { status: 404 });
}

async function session(requests: Array<unknown>) {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Array<string> = [];
  output.on("data", (chunk: Buffer) => {
    chunks.push(chunk.toString());
  });
  const served = serve({ input, output }, site);
  for (const request of requests) {
    input.write(
      `${typeof request === "string" ? request : JSON.stringify(request)}\n`,
    );
  }
  input.end();
  await served;
  return chunks
    .join("")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Message)
    .toSorted((a, b) => (a.id ?? -1) - (b.id ?? -1));
}

function call(id: number, name: string, input: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: input },
  };
}

function resultOf(message: Message | undefined): unknown {
  return JSON.parse(message?.result?.content?.[0]?.text ?? "null");
}

describe("the MCP server", () => {
  it("introduces itself and lists its four tools", async () => {
    const [initialized, listed] = await session([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);
    const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
      version: string;
    };
    expect(initialized?.result?.serverInfo?.version).toBe(version);
    expect(listed?.result?.tools?.map((tool) => tool.name)).toStrictEqual([
      "inspect_page",
      "check_budget",
      "advise_page_data",
      "explain_island",
    ]);
  });

  it("inspects a page", async () => {
    const [inspected] = await session([
      call(1, "inspect_page", { url: "https://site.test/products" }),
    ]);
    expect(resultOf(inspected)).toMatchObject({
      client: "sveltekit",
      islands: [{ name: "counter" }, { name: "list" }],
    });
  });

  it("advises a part for large page data, but not for a part", async () => {
    const [advised] = await session([
      call(1, "advise_page_data", { url: "https://site.test/products" }),
    ]);
    const { entries } = resultOf(advised) as {
      entries: Array<{ path: string; isPart: boolean; advice: string | null }>;
    };
    expect(entries.map((entry) => entry.path)).toStrictEqual([
      "rows",
      "products",
      "title",
    ]);
    expect(entries[0]?.advice).toContain("Wrap rows in part()");
    expect(entries[1]).toMatchObject({ isPart: true, advice: null });
  });

  it("explains why an island hydrates, and names the islands it can't find", async () => {
    const [counter, list, missing] = await session([
      call(1, "explain_island", {
        url: "https://site.test/products",
        island: "counter",
      }),
      call(2, "explain_island", {
        url: "https://site.test/products",
        island: "list",
      }),
      call(3, "explain_island", {
        url: "https://site.test/products",
        island: "cart",
      }),
    ]);
    expect(resultOf(counter)).toMatchObject([
      { explanation: "It hydrates because it reads count, which can change." },
    ]);
    expect(resultOf(list)).toMatchObject([
      { explanation: "It never hydrates, because nothing in it can change." },
    ]);
    expect(missing?.result?.isError).toBe(true);
    expect(missing?.result?.content?.[0]?.text).toContain("counter, list");
  });

  it("answers bad requests with JSON-RPC errors", async () => {
    const messages = await session([
      "{not json",
      { jsonrpc: "2.0", id: 1, method: "resources/list" },
      call(2, "delete_everything", {}),
    ]);
    expect(
      messages.map((message) => [message.id, message.error?.code]),
    ).toStrictEqual([
      [null, -32_700],
      [1, -32_601],
      [2, -32_602],
    ]);
  });
});
