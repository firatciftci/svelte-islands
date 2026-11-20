import type { Readable, Writable } from "node:stream";
import { stringify, unflatten } from "devalue";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { isWithinBudget, parseBudget } from "./budget.js";
import { inspect } from "./inspect.js";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type Arguments = Record<string, unknown>;
type Tool = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: Array<string>;
  };
  call: (input: Arguments, fetcher: Fetcher) => Promise<unknown>;
};

const PROTOCOL = "2025-06-18";
const PREFIX = "/_parts/";
const ADVISE = 4;
const MARK = Symbol("custom");
const URL_INPUT = {
  type: "string",
  description: "The page's full URL, such as http://localhost:5173/products",
};

function versionOf() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const file = path.join(dir, "package.json");
    if (existsSync(file)) {
      const found = JSON.parse(readFileSync(file, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (found.name === "svelte-islands") {
        return found.version ?? "0.0.0";
      }
    }
    const up = path.dirname(dir);
    if (up === dir) {
      return "0.0.0";
    }
    dir = up;
  }
}

function text(input: Arguments, name: string) {
  const value = input[name];
  if (typeof value !== "string" || value === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function pageUrl(input: Arguments) {
  const url = text(input, "url");
  if (!URL.canParse(url)) {
    throw new Error(`${url} isn't a full URL`);
  }
  return url;
}

function prefixOf(input: Arguments) {
  return typeof input.prefix === "string" ? input.prefix : PREFIX;
}

const revivers = new Proxy<Record<string, (value: unknown) => unknown>>(
  {},
  {
    get: (_, type) => (value: unknown) => ({ [MARK]: String(type), value }),
    getOwnPropertyDescriptor: (_, type) => ({
      configurable: true,
      enumerable: true,
      value: (value: unknown) => ({ [MARK]: String(type), value }),
    }),
  },
);

function customOf(value: unknown) {
  return typeof value === "object" &&
    value != null &&
    Object.hasOwn(value, MARK)
    ? (value as { [MARK]: string; value: unknown })
    : null;
}

function sizeOf(value: unknown) {
  try {
    return stringify(value, {
      custom: (item: unknown) => {
        const found = customOf(item);
        return found != null && [found.value];
      },
    }).length;
  } catch {
    return null;
  }
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value != null &&
    customOf(value) == null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

async function adviseOf(input: Arguments, fetcher: Fetcher) {
  const page = new URL(pageUrl(input));
  const limit =
    typeof input.advise === "number" && input.advise > 0
      ? input.advise
      : ADVISE;
  const data = new URL(
    `${page.pathname.replace(/\/$/u, "")}/__data.json${page.search}`,
    page.origin,
  );
  const response = await fetcher(data.href, {});
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${data.href}`);
  }
  const sent = (await response.json()) as {
    nodes?: Array<{ type: string; data?: Array<unknown> } | null>;
  };
  const merged: Record<string, unknown> = {};
  const nodes = sent.nodes ?? [];
  for (const node of nodes) {
    if (node?.type === "data" && node.data != null) {
      Object.assign(merged, unflatten(node.data, revivers));
    }
  }
  const entries: Array<{
    path: string;
    bytes: number | null;
    isPart: boolean;
    advice: string | null;
  }> = [];
  const add = (key: string, value: unknown) => {
    const bytes = sizeOf(value);
    const isPart = customOf(value)?.[MARK] === "part";
    const isLarge = bytes != null && bytes > limit * 1024;
    entries.push({
      path: key,
      bytes,
      isPart,
      advice:
        isLarge && !isPart
          ? `Wrap ${key} in part() so islands can load it, and the page doesn't carry it.`
          : null,
    });
    return isLarge;
  };
  for (const [key, value] of Object.entries(merged)) {
    if (add(key, value) && isPlain(value)) {
      for (const [inner, nested] of Object.entries(value)) {
        add(`${key}.${inner}`, nested);
      }
    }
  }
  return {
    url: page.href,
    advise: limit,
    entries: entries.toSorted((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)),
  };
}

async function explain(input: Arguments, fetcher: Fetcher) {
  const wanted = text(input, "island");
  const found = await inspect(pageUrl(input), prefixOf(input), fetcher);
  const matches = found.islands.filter(
    (island) => island.name === wanted || island.hash === wanted,
  );
  if (matches.length === 0) {
    const names = found.islands.map((island) => island.name ?? island.hash);
    throw new Error(
      `There's no island named ${wanted} on ${found.url}. The page has ${names.length === 0 ? "no islands" : names.join(", ")}.`,
    );
  }
  return matches.map((island) => ({
    ...island,
    explanation:
      island.why === "inferred"
        ? "It never hydrates, because nothing in it can change."
        : island.why == null
          ? "The page doesn't say. Islands explain themselves only on the dev server, and only when their hydrate prop isn't set."
          : `It hydrates because ${island.why}.`,
  }));
}

const TOOLS: Array<Tool> = [
  {
    name: "inspect_page",
    description:
      "Lists the islands on a page: where each one's HTML comes from, the size of its part, whether its code has its own chunk, and when it hydrates.",
    inputSchema: {
      type: "object",
      properties: {
        url: URL_INPUT,
        prefix: {
          type: "string",
          description: "The URL prefix of parts. The default is /_parts/",
        },
      },
      required: ["url"],
    },
    call: async (input, fetcher) =>
      inspect(pageUrl(input), prefixOf(input), fetcher),
  },
  {
    name: "check_budget",
    description:
      "Checks pages against an islands.budget.json file and reports each page's HTML, gzip, and inline script sizes, and whether it's over a limit.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The site's origin, such as http://localhost:4173",
        },
        config: {
          type: "string",
          description:
            "The budget file. The default is islands.budget.json in the working directory",
        },
      },
      required: ["url"],
    },
    call: async (input, fetcher) => {
      const file =
        typeof input.config === "string" ? input.config : "islands.budget.json";
      const budget = parseBudget(readFileSync(file, "utf8"));
      const pages: Array<string> = [];
      const problems: Array<string> = [];
      const isWithin = await isWithinBudget(
        pageUrl(input),
        budget,
        {
          out: (line) => {
            pages.push(line);
          },
          err: (line) => {
            problems.push(line);
          },
        },
        fetcher,
      );
      return { isWithinBudget: isWithin, pages, problems };
    },
  },
  {
    name: "advise_page_data",
    description:
      "Lists a page's load data by size, and names the large values that should become parts.",
    inputSchema: {
      type: "object",
      properties: {
        url: URL_INPUT,
        advise: {
          type: "number",
          description:
            "Suggests a part for values larger than this many KiB. The default is 4",
        },
      },
      required: ["url"],
    },
    call: adviseOf,
  },
  {
    name: "explain_island",
    description:
      "Explains why an island hydrates or never does, from what the dev server writes on the page.",
    inputSchema: {
      type: "object",
      properties: {
        url: URL_INPUT,
        island: {
          type: "string",
          description: "The island's part name, or its hash",
        },
        prefix: {
          type: "string",
          description: "The URL prefix of parts. The default is /_parts/",
        },
      },
      required: ["url", "island"],
    },
    call: explain,
  },
];

type Request = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

async function answer(request: Request, fetcher: Fetcher) {
  switch (request.method) {
    case "initialize": {
      const asked = request.params?.protocolVersion;
      return {
        protocolVersion: typeof asked === "string" ? asked : PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "svelte-islands", version: versionOf() },
      };
    }
    case "ping": {
      return {};
    }
    case "tools/list": {
      return {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      };
    }
    case "tools/call": {
      const name = request.params?.name;
      const tool = TOOLS.find((each) => each.name === name);
      if (tool == null) {
        throw Object.assign(new Error(`Unknown tool: ${String(name)}`), {
          code: -32_602,
        });
      }
      const input = request.params?.arguments;
      try {
        const result = await tool.call(
          typeof input === "object" && input != null
            ? (input as Arguments)
            : {},
          fetcher,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        };
      }
    }
    default: {
      throw Object.assign(new Error(`Unknown method: ${request.method}`), {
        code: -32_601,
      });
    }
  }
}

function isRequest(value: unknown): value is Request {
  return (
    typeof value === "object" &&
    value != null &&
    "method" in value &&
    typeof value.method === "string"
  );
}

/**
 * Serves the MCP tools over newline-delimited JSON-RPC until `input` ends.
 *
 * @param streams Where requests come from and responses go.
 * @param fetcher Fetches pages, so tests can stand in for a server.
 */
export async function serve(
  {
    input = process.stdin,
    output = process.stdout,
  }: { input?: Readable; output?: Writable } = {},
  fetcher: Fetcher = fetch,
) {
  const send = (message: unknown) => {
    output.write(`${JSON.stringify(message)}\n`);
  };
  const respond = async (request: Request, id: string | number) => {
    try {
      const result = await answer(request, fetcher);
      send({ jsonrpc: "2.0", id, result });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id,
        error: {
          code:
            typeof error === "object" &&
            error != null &&
            "code" in error &&
            typeof error.code === "number"
              ? error.code
              : -32_603,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };
  const pending: Array<Promise<void>> = [];
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32_700, message: "Parse error" },
      });
      continue;
    }
    if (!isRequest(request)) {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32_600, message: "Invalid request" },
      });
      continue;
    }
    const { id } = request;
    if (id == null) {
      continue;
    }
    pending.push(respond(request, id));
  }
  await Promise.all(pending);
}
