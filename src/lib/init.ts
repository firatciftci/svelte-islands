import type { AST } from "svelte/compiler";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { parse as parseSvelte } from "svelte/compiler";
import type { Node } from "./extract.js";
import { children, nodesOf } from "./extract.js";

const USAGE = `Usage: svelte-islands init [<directory>] [--store redis|r2|none]

Sets up svelte-islands in a SvelteKit app: the transport in src/hooks,
the handle in src/hooks.server, the stylesheet in the root layout, and
the Vite plugin in the Vite config. It changes only what's missing, so
it's safe to run again. When the app sets paths.base, the transport
gets the matching prefix.

Options:
  --store <kind>  Where parts are kept: redis (with ioredis and
                  REDIS_URL), r2 (with an R2 binding named PARTS), or
                  none, the default, which keeps them in memory
  -h, --help      Prints this text
`;

type Output = { out: (line: string) => void; err: (line: string) => void };

type Step = { file: string; change: (text: string | null) => string | null };

const TERMINAL: Output = {
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  err: (line) => {
    process.stderr.write(`${line}\n`);
  },
};

const OPEN = '<script lang="ts">';

function callsIn(text: string, name: string) {
  let root: AST.Root;
  try {
    root = parseSvelte(`${OPEN}${text}</script>`, { modern: true });
  } catch {
    return null;
  }
  const found: Array<{ start: number; end: number }> = [];
  const visit = (node: Node) => {
    const callee =
      node.type === "CallExpression" ? (node.callee as Node) : null;
    if (callee?.type === "Identifier" && callee.name === name) {
      found.push({
        start: node.start - OPEN.length,
        end: node.end - OPEN.length,
      });
    }
    for (const child of children(node)) {
      visit(child);
    }
  };
  const statements = nodesOf(root.instance?.content.body ?? []);
  for (const statement of statements) {
    visit(statement);
  }
  return found;
}

function appended(text: string, block: string) {
  return `${text.trimEnd()}\n\n${block}\n`;
}

function afterImports(text: string, line: string) {
  const imports = text.matchAll(/^import\b[^;]*(?:;[^\S\n]*)?$/gmu).toArray();
  const last = imports.at(-1);
  if (last == null) {
    return `${line}\n\n${text}`;
  }
  const end = last.index + last[0].length;
  return `${text.slice(0, end)}\n${line}${text.slice(end)}`;
}

type Store = "redis" | "r2" | "none";

const STORES: ReadonlyArray<Store> = ["redis", "r2", "none"];

function fresh(text: string, name: string) {
  let candidate = name;
  for (
    let count = 2;
    new RegExp(String.raw`\b${candidate}\b`, "u").test(text);
    count++
  ) {
    candidate = `${name}${count}`;
  }
  return candidate;
}

function listed(text: string, name: string) {
  for (const found of text.matchAll(/export\s*\{([^}]*)\}/gu)) {
    const inner = found[1] ?? "";
    for (const entry of inner.split(",")) {
      const named = /^\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/u.exec(entry);
      if (named?.[1] != null && (named[2] ?? named[1]) === name) {
        const at = found.index + found[0].indexOf(inner);
        return { local: named[1], start: at + inner.indexOf(entry), entry };
      }
    }
  }
  return null;
}

function exported(
  text: string,
  name: string,
  line: string,
  wrap: (local: string) => string,
) {
  const declared = new RegExp(
    String.raw`export\s+(const\s+${name}\b|(async\s+)?function\s+${name}\b)`,
    "u",
  );
  const found = declared.exec(text);
  if (found != null) {
    const local = fresh(text, name === "handle" ? "app" : "codecs");
    const replacement =
      found[1]?.startsWith("const") === true
        ? `const ${local}`
        : `${found[2] ?? ""}function ${local}`;
    const renamed = text.replace(declared, () => replacement);
    return appended(
      afterImports(renamed, line),
      `export const ${name} = ${wrap(local)};`,
    );
  }
  const entry = listed(text, name);
  if (entry != null) {
    const local = fresh(text, `${name}WithIslands`);
    const replaced = `${text.slice(0, entry.start)}${entry.entry.replace(/\S.*\S|\S/u, () => `${local} as ${name}`)}${text.slice(entry.start + entry.entry.length)}`;
    return appended(
      afterImports(replaced, line),
      `const ${local} = ${wrap(entry.local)};`,
    );
  }
  return null;
}

export function transport(text: string | null, prefix: string | null = null) {
  const line = `import { islands } from "svelte-islands";`;
  const options = (codecs: string | null) => {
    const entries = [
      ...(codecs == null
        ? []
        : [codecs === "codecs" ? "codecs" : `codecs: ${codecs}`]),
      ...(prefix == null ? [] : [`prefix: ${JSON.stringify(prefix)}`]),
    ];
    return entries.length === 0 ? "" : `{ ${entries.join(", ")} }`;
  };
  const made = `export const transport = islands(${options(null)});`;
  if (text == null || text.trim() === "") {
    return appended(line, made);
  }
  if (text.includes("svelte-islands")) {
    return null;
  }
  return (
    exported(
      text,
      "transport",
      line,
      (local) => `islands(${options(local)})`,
    ) ?? appended(afterImports(text, line), made)
  );
}

function storeSetup(store: Store, text: string) {
  switch (store) {
    case "redis": {
      const client = fresh(text, "client");
      return {
        imports: [
          `import { REDIS_URL } from "$app/env/private";`,
          `import { Redis } from "ioredis";`,
          `import { compressed, redisStore } from "svelte-islands/stores";`,
        ],
        before: `const ${client} = new Redis(REDIS_URL);`,
        options: `{ store: compressed(redisStore(${client}, { ttl: 60 * 60 * 24 * 30 })) }`,
      };
    }
    case "r2": {
      return {
        imports: [
          `import { env } from "cloudflare:workers";`,
          `import { r2Store } from "svelte-islands/stores";`,
        ],
        before: null,
        options:
          "{ store: r2Store(() => env.PARTS), memory: 16 * 1024 * 1024 }",
      };
    }
    default: {
      return { imports: [], before: null, options: "" };
    }
  }
}

export function handle(text: string | null, store: Store = "none") {
  const setup = storeSetup(store, text ?? "");
  const line = [
    ...setup.imports,
    `import { handle as islands } from "svelte-islands/server";`,
  ].join("\n");
  const made = `islands(${setup.options})`;
  const withBefore = (code: string) =>
    setup.before == null ? code : afterImports(code, `\n${setup.before}`);
  if (text == null || text.trim() === "") {
    return appended(withBefore(line), `export const handle = ${made};`);
  }
  if (text.includes("svelte-islands")) {
    return null;
  }
  const hasSequence =
    /import\s*\{[^}]*\bsequence\b[^}]*\}\s*from\s*["']@sveltejs\/kit\/hooks["']/u.test(
      text,
    );
  const withSequence = hasSequence
    ? line
    : `import { sequence } from "@sveltejs/kit/hooks";\n${line}`;
  const wrapped = exported(
    text,
    "handle",
    withSequence,
    (local) => `sequence(${made}, ${local})`,
  );
  return wrapped == null
    ? appended(
        withBefore(afterImports(text, line)),
        `export const handle = ${made};`,
      )
    : withBefore(wrapped);
}

const BASE = /\bpaths\s*:\s*\{[^}]*?\bbase\s*:\s*([^,}\n]+)/u;

export function baseOf(texts: ReadonlyArray<string | null>) {
  for (const text of texts) {
    const value = text == null ? undefined : BASE.exec(text)?.[1]?.trim();
    if (value != null) {
      const literal = /^(["'`])(\/[^"'`$]*)\1$/u.exec(value)?.[2];
      return literal == null
        ? { base: null, isUnread: true }
        : { base: literal.replace(/\/$/u, ""), isUnread: false };
    }
  }
  return { base: null, isUnread: false };
}

export function vite(text: string | null) {
  if (text == null) {
    throw new Error(
      "there's no Vite config, so add islands() from svelte-islands/vite next to sveltekit() in yours",
    );
  }
  if (text.includes("svelte-islands/vite")) {
    return null;
  }
  if ((callsIn(text, "islands") ?? []).length > 0) {
    throw new Error(
      "the Vite config already calls islands(), but doesn't import it from svelte-islands/vite, so check it yourself",
    );
  }
  const [call] = callsIn(text, "sveltekit") ?? [];
  const end = call == null ? -1 : call.end - 1;
  if (end === -1) {
    throw new Error(
      "can't find sveltekit() in the Vite config, so add islands() from svelte-islands/vite next to it yourself",
    );
  }
  const added = `${text.slice(0, end + 1)}, islands()${text.slice(end + 1)}`;
  return afterImports(added, `import { islands } from "svelte-islands/vite";`);
}

export function layout(text: string | null) {
  const line = `import "svelte-islands/styles.css";`;
  if (text == null) {
    return `<script>\n  ${line}\n\n  const { children } = $props();\n</script>\n\n{@render children()}\n`;
  }
  if (text.includes("svelte-islands/styles.css")) {
    return null;
  }
  const script = /<script(?![^>]+\bmodule\b)[^>]*>/u.exec(text);
  if (script == null) {
    return `<script>\n  ${line}\n</script>\n\n${text}`;
  }
  const at = script.index + script[0].length;
  return `${text.slice(0, at)}\n  ${line}${text.slice(at)}`;
}

function pick(root: string, names: ReadonlyArray<string>) {
  const found = names.find((name) => existsSync(path.join(root, name)));
  return found ?? names[0] ?? "";
}

const VITE_CONFIGS = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mts",
  "vite.config.mjs",
];

function stepsFor(
  root: string,
  { prefix, store }: { prefix: string | null; store: Store },
): Array<Step> {
  const extension = existsSync(path.join(root, "tsconfig.json")) ? "ts" : "js";
  return [
    {
      file: pick(root, [
        `src/hooks.${extension}`,
        "src/hooks.ts",
        "src/hooks.js",
      ]),
      change: (text) => transport(text, prefix),
    },
    {
      file: pick(root, [
        `src/hooks.server.${extension}`,
        "src/hooks.server.ts",
        "src/hooks.server.js",
      ]),
      change: (text) => handle(text, store),
    },
    { file: "src/routes/+layout.svelte", change: layout },
    { file: pick(root, VITE_CONFIGS), change: vite },
  ];
}

async function contents(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

const NOTES: Record<Store, string | null> = {
  redis:
    "note: the store needs ioredis, so install it, and set REDIS_URL in your environment",
  r2: "note: the store needs an R2 bucket bound as PARTS in your Wrangler config",
  none: null,
};

export async function run(
  args: Array<string>,
  { out, err }: Output = TERMINAL,
) {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    err(messageOf(error));
    err(USAGE);
    return 2;
  }
  const { positionals, values } = parsed;
  if (values.help === true) {
    out(USAGE);
    return 0;
  }
  const store = STORES.find((kind) => kind === (values.store ?? "none"));
  if (store == null) {
    err(`--store takes redis, r2, or none, not ${values.store ?? ""}.`);
    err(USAGE);
    return 2;
  }
  const root = path.resolve(positionals[0] ?? ".");
  if (!existsSync(path.join(root, "package.json"))) {
    err(`There's no package.json in ${root}.`);
    err(USAGE);
    return 2;
  }
  const configs = await Promise.all(
    [...VITE_CONFIGS, "svelte.config.js", "svelte.config.ts"].map(
      async (name) => contents(path.join(root, name)),
    ),
  );
  const { base, isUnread } = baseOf(configs);
  const prefix = base == null || base === "" ? null : `${base}/_parts/`;
  const steps = stepsFor(root, { prefix, store });
  let isClean = true;
  for (const step of steps) {
    if (!(await isStepClean(root, step, { out, err }))) {
      isClean = false;
    }
  }
  if (isUnread) {
    out(
      'note: paths.base isn\'t a plain string, so pass its prefix to islands() in src/hooks yourself, as in islands({ prefix: "/base/_parts/" })',
    );
  }
  const note = NOTES[store];
  if (note != null) {
    out(note);
  }
  return isClean ? 0 : 1;
}

async function isStepClean(root: string, step: Step, { out, err }: Output) {
  const file = path.join(root, step.file);
  const before = await contents(file);
  try {
    const after = step.change(before);
    if (after == null) {
      out(`unchanged: ${step.file}`);
      return true;
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, after);
    out(`${before == null ? "created" : "updated"}: ${step.file}`);
    return true;
  } catch (error) {
    err(`skipped: ${step.file}: ${messageOf(error)}`);
    return false;
  }
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parse(args: Array<string>) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      store: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}
