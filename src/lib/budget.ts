import { readFile } from "node:fs/promises";
import process from "node:process";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

const KINDS = ["raw", "gzip", "inline"] as const;
const SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>(.*?)<\/script>/gisu;
const CONFIG = "islands.budget.json";
const USAGE = `Usage: svelte-islands check <url> [--config <file>]

Fetches each page in the budget from <url> and fails if a page is over
a limit. Limits are in KiB: raw is the HTML, gzip is the HTML after
gzip, and inline is the scripts written into the page. The default
config file is ${CONFIG}:

  {
    "limits": { "raw": 400, "gzip": 60, "inline": 150 },
    "pages": { "/": {}, "/largest-page": { "raw": 800 } }
  }

Options:
  -c, --config <file>  The budget file
  -h, --help           Prints this text

Exit codes: 0 when every page is within its limits, 1 when a page is
over one, and 2 when the command or the config file is wrong.
`;

type Kind = (typeof KINDS)[number];
type Limits = Partial<Record<Kind, number>>;
type Budget = { limits: Limits; pages: Record<string, Limits> };
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type Output = { out: (line: string) => void; err: (line: string) => void };

const TERMINAL: Output = {
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  err: (line) => {
    process.stderr.write(`${line}\n`);
  },
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function limitsOf(value: unknown, where: string): Limits {
  if (!isRecord(value)) {
    throw new Error(`${where} must be an object`);
  }
  const limits: Limits = {};
  for (const [kind, limit] of Object.entries(value)) {
    if (!(KINDS as ReadonlyArray<string>).includes(kind)) {
      throw new Error(`${where} has an unknown limit: ${kind}`);
    }
    if (typeof limit !== "number" || limit <= 0) {
      throw new Error(`${where}.${kind} must be a positive number`);
    }
    limits[kind as Kind] = limit;
  }
  return limits;
}

export function parseBudget(text: string): Budget {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed) || !isRecord(parsed.pages)) {
    throw new Error('The budget needs a "pages" object');
  }
  const pages: Record<string, Limits> = {};
  for (const [path, limits] of Object.entries(parsed.pages)) {
    if (!path.startsWith("/")) {
      throw new Error(`Page paths start with a slash: ${path}`);
    }
    pages[path] = limitsOf(limits, `pages["${path}"]`);
  }
  return { limits: limitsOf(parsed.limits ?? {}, "limits"), pages };
}

export function measure(body: Uint8Array) {
  const text = new TextDecoder("latin1").decode(body);
  let inline = 0;
  for (const [, script] of text.matchAll(SCRIPT)) {
    inline += script?.length ?? 0;
  }
  return {
    raw: body.length,
    gzip: gzipSync(body, { level: 6 }).length,
    inline,
  };
}

async function fetched(url: string, fetcher: Fetcher, retries = 1) {
  try {
    const response = await fetcher(url, {
      headers: { "accept-encoding": "identity" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (retries === 0) {
      throw error;
    }
    return fetched(url, fetcher, retries - 1);
  }
}

function kib(size: number) {
  return `${Math.round(size / 1024).toLocaleString("en-US")} KiB`;
}

export async function isWithinBudget(
  base: string,
  { limits, pages }: Budget,
  { out, err }: Output,
  fetcher: Fetcher = fetch,
) {
  const origin = base.replace(/\/+$/u, "");
  let isOver = false;
  for (const [path, own] of Object.entries(pages)) {
    const url = `${origin}${path}`;
    let body: Uint8Array;
    try {
      body = await fetched(url, fetcher);
    } catch (error) {
      isOver = true;
      err(`failed: ${path}: ${messageOf(error)}`);
      continue;
    }
    const sizes = measure(body);
    const cells: Array<string> = [];
    for (const kind of KINDS) {
      const limit = own[kind] ?? limits[kind];
      if (limit == null) {
        cells.push(`${kind} ${kib(sizes[kind])}`);
        continue;
      }
      cells.push(`${kind} ${kib(sizes[kind])} of ${limit} KiB`);
      if (sizes[kind] > limit * 1024) {
        isOver = true;
        err(
          `over budget: ${path}: ${kind} ${kib(sizes[kind])} is over ${limit} KiB`,
        );
      }
    }
    out(`${path}  ${cells.join("  ")}`);
  }
  return !isOver;
}

export async function run(
  args: Array<string>,
  output = TERMINAL,
  fetcher: Fetcher = fetch,
) {
  let options: ReturnType<typeof parse>;
  try {
    options = parse(args);
  } catch (error) {
    output.err(messageOf(error));
    output.err(USAGE);
    return 2;
  }
  const { positionals, values } = options;
  if (values.help === true) {
    output.out(USAGE);
    return 0;
  }
  const [command, base] = positionals;
  if (command !== "check" || base == null || !URL.canParse(base)) {
    output.err(USAGE);
    return 2;
  }
  const file = values.config ?? CONFIG;
  let budget: Budget;
  try {
    budget = parseBudget(await readFile(file, "utf8"));
  } catch (error) {
    output.err(`Can't read ${file}: ${messageOf(error)}`);
    return 2;
  }
  return (await isWithinBudget(base, budget, output, fetcher)) ? 0 : 1;
}

function parse(args: Array<string>) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      config: { type: "string", short: "c" },
      help: { type: "boolean", short: "h" },
    },
  });
}
