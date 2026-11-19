import process from "node:process";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import type { Shell } from "./part.js";
import { measure } from "./budget.js";
import { deserialize } from "./part.js";

const USAGE = `Usage: svelte-islands inspect <url> [--json] [--prefix <path>]

Fetches the page at <url> and lists its islands: where each one's HTML
comes from, the size of its part, whether its code has its own chunk,
and, on a page with csr = false, what the island boot sends it.

Options:
  --json             Prints one JSON object instead of text
  -p, --prefix <path>  The URL prefix of parts. The default is /_parts/
  -h, --help         Prints this text

Exit codes: 0 when the page was read, 1 when it couldn't be fetched,
and 2 when the command is wrong.
`;

const ISLAND = /<(?:div|tbody)\b([^>]*\sdata-island="[^"]+"[^>]*)>/gu;
const ATTRIBUTE = /([\w-]+)="([^"]*)"/gu;
const PAYLOAD =
  /<script type="application\/json" id="svelte-islands">(.*?)<\/script>/su;
const NATIVE = /__sveltekit_\w+\s*=\s*\{/u;
const RULES = /<script type="speculationrules">(.*?)<\/script>/su;
const ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&#34;": '"',
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
};

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type Output = { out: (line: string) => void; err: (line: string) => void };
type Sent = Omit<Shell, "scope" | "context"> & {
  scope: Record<string, unknown> | null;
  context: Array<[isSymbol: boolean, name: string, value: unknown]>;
};

export type Inspected = {
  url: string;
  html: { raw: number; gzip: number; inline: number };
  client: "sveltekit" | "islands" | "none";
  speculation: "prefetch" | "prerender" | null;
  islands: Array<{
    hash: string;
    name: string | null;
    state: string | null;
    module: string | null;
    file: string | null;
    needs: number;
    part: { raw: number; gzip: number } | null;
    hydrate: Array<string> | null;
    why: string | null;
    scope: Array<string> | null;
    context: Array<string> | null;
  }>;
};

const TERMINAL: Output = {
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  err: (line) => {
    process.stderr.write(`${line}\n`);
  },
};

function decoded(text: string) {
  return text.replaceAll(
    /&(?:quot|#34|#39|lt|gt|amp);/gu,
    (entity) => ENTITIES[entity] ?? entity,
  );
}

function attributesOf(tag: string) {
  const found = new Map<string, string>();
  for (const [, name, value] of tag.matchAll(ATTRIBUTE)) {
    if (name != null && value != null) {
      found.set(name, decoded(value));
    }
  }
  return found;
}

function sentOf(html: string) {
  const text = PAYLOAD.exec(html)?.[1];
  if (text == null) {
    return [];
  }
  try {
    return deserialize(decoded(text)) as Array<Sent>;
  } catch {
    return [];
  }
}

function speculationOf(html: string): Inspected["speculation"] {
  const text = RULES.exec(html)?.[1];
  if (text == null) {
    return null;
  }
  try {
    const rules: unknown = JSON.parse(text);
    if (typeof rules === "object" && rules != null) {
      return "prerender" in rules ? "prerender" : "prefetch";
    }
  } catch {
    return null;
  }
  return null;
}

function needsOf(text: string | undefined) {
  if (text == null) {
    return 0;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

async function partSize(url: string, fetcher: Fetcher) {
  try {
    const response = await fetcher(url, {
      headers: { "accept-encoding": "identity" },
    });
    if (!response.ok) {
      return null;
    }
    const body = new Uint8Array(await response.arrayBuffer());
    return { raw: body.length, gzip: gzipSync(body, { level: 6 }).length };
  } catch {
    return null;
  }
}

type Island = Inspected["islands"][number];
type Size = Island["part"];

function islandOf(
  attributes: Map<string, string>,
  queued: Map<string, Array<Sent>>,
): Omit<Island, "part"> {
  const hash = attributes.get("data-island") ?? "";
  const module = attributes.get("data-island-module") ?? null;
  const record = module == null ? undefined : queued.get(hash)?.shift();
  return {
    hash,
    name: record?.part.name ?? attributes.get("data-island-name") ?? null,
    state: attributes.get("data-island-state") ?? null,
    module,
    file: attributes.get("data-island-file") ?? null,
    needs: needsOf(attributes.get("data-island-needs")),
    hydrate:
      record == null
        ? null
        : (record.hydrate ?? [
            record.state === "client" ? "visible" : "interaction",
          ]),
    why: attributes.get("data-island-why") ?? null,
    scope: record?.scope == null ? null : Object.keys(record.scope),
    context:
      record == null
        ? null
        : record.context.map(([isSymbol, name]) =>
            isSymbol ? `Symbol.for("${name}")` : name,
          ),
  };
}

export async function inspect(
  url: string,
  prefix: string,
  fetcher: Fetcher = fetch,
): Promise<Inspected> {
  const response = await fetcher(url, {
    headers: { "accept-encoding": "identity" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  const html = new TextDecoder().decode(body);
  const sent = sentOf(html);
  const queued = new Map<string, Array<Sent>>();
  for (const island of sent) {
    const list = queued.get(island.part.hash) ?? [];
    list.push(island);
    queued.set(island.part.hash, list);
  }
  const sizes = new Map<string, Promise<Size>>();
  const origin = new URL(url).origin;
  const sizeOf = async (hash: string) => {
    let size = sizes.get(hash);
    if (size == null) {
      size = partSize(new URL(`${prefix}${hash}.json`, origin).href, fetcher);
      sizes.set(hash, size);
    }
    return size;
  };
  const islands = html
    .matchAll(ISLAND)
    .map(([, tag = ""]) => islandOf(attributesOf(tag), queued))
    .toArray();
  return {
    url,
    html: measure(body),
    client: NATIVE.test(html)
      ? "sveltekit"
      : sent.length > 0
        ? "islands"
        : "none",
    speculation: speculationOf(html),
    islands: await Promise.all(
      islands.map(async (island) => ({
        ...island,
        part: await sizeOf(island.hash),
      })),
    ),
  };
}

function kib(size: number) {
  return size < 1024
    ? `${size.toLocaleString("en-US")} B`
    : `${(size / 1024).toLocaleString("en-US", { maximumFractionDigits: 1 })} KiB`;
}

const STATES: Record<string, string> = {
  static: "server HTML",
  deferred: "deferred HTML",
  client: "rendered in the browser",
  fresh: "fresh HTML",
};

const CLIENTS: Record<Inspected["client"], string> = {
  sveltekit: "SvelteKit hydrates the page",
  islands: "only the island boot runs (csr = false)",
  none: "no JavaScript runs islands (csr = false)",
};

function cellsOf(island: Island, client: Inspected["client"]) {
  const cells = [
    island.name ?? island.hash,
    island.state == null
      ? "rendered with the page"
      : (STATES[island.state] ?? island.state),
    island.part == null
      ? "part in the page"
      : `part ${kib(island.part.raw)} (${kib(island.part.gzip)} gzipped)`,
    island.module == null ? "code in the page" : "code in its own chunk",
  ];
  if (client === "islands" && island.hydrate == null) {
    cells.push("not sent by the boot, so it stays as server HTML");
  }
  if (island.needs > 0) {
    cells.push(
      `reads ${island.needs} more ${island.needs === 1 ? "part" : "parts"}`,
    );
  }
  if (island.hydrate != null) {
    cells.push(`hydrates on ${island.hydrate.join(" or ")}`);
  }
  if (island.scope != null && island.scope.length > 0) {
    cells.push(`gets ${island.scope.join(", ")}`);
  }
  if (island.why === "inferred") {
    cells.push("never hydrates, because nothing in it can change");
  } else if (island.why != null) {
    cells.push(`hydrates because ${island.why}`);
  }
  return cells;
}

export function describe(found: Inspected) {
  const lines = [
    found.url,
    `  html ${kib(found.html.raw)}, ${kib(found.html.gzip)} gzipped, ${kib(found.html.inline)} of inline scripts`,
    `  ${CLIENTS[found.client]}${found.speculation == null ? "" : `, speculation rules ${found.speculation} on hover`}`,
    `  ${found.islands.length === 1 ? "1 island" : `${found.islands.length} islands`}`,
  ];
  for (const island of found.islands) {
    lines.push(`    ${cellsOf(island, found.client).join(", ")}`);
  }
  return lines.join("\n");
}

export async function run(
  args: Array<string>,
  { out, err }: Output = TERMINAL,
  fetcher: Fetcher = fetch,
) {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    err(error instanceof Error ? error.message : String(error));
    err(USAGE);
    return 2;
  }
  const { positionals, values } = parsed;
  if (values.help === true) {
    out(USAGE);
    return 0;
  }
  const [url] = positionals;
  if (url == null || !URL.canParse(url)) {
    err(USAGE);
    return 2;
  }
  let found: Inspected;
  try {
    found = await inspect(url, values.prefix ?? "/_parts/", fetcher);
  } catch (error) {
    err(
      `Can't read ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  out(values.json === true ? JSON.stringify(found, null, 2) : describe(found));
  return 0;
}

function parse(args: Array<string>) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      prefix: { type: "string", short: "p" },
      help: { type: "boolean", short: "h" },
    },
  });
}
