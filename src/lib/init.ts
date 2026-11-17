import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const USAGE = `Usage: svelte-islands init [<directory>]

Sets up svelte-islands in a SvelteKit app: the transport in src/hooks,
the handle in src/hooks.server, the stylesheet in the root layout, and
the Vite plugin in the Vite config. It changes only what's missing, so
it's safe to run again.
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

function closing(text: string, open: number) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function afterImports(text: string, line: string) {
  const imports = text.matchAll(/^import\b[^;]*(?:;[^\S\n]*)?$/gmu).toArray();
  const last = imports.at(-1);
  if (last == null) {
    return `${line}\n${text}`;
  }
  const end = last.index + last[0].length;
  return `${text.slice(0, end)}\n${line}${text.slice(end)}`;
}

export function transport(text: string | null) {
  if (text == null) {
    return `import { islands } from "svelte-islands";\n\nexport const transport = islands();\n`;
  }
  if (text.includes("svelte-islands")) {
    return null;
  }
  if (/export\s+const\s+transport\b/u.test(text)) {
    const renamed = text.replace(
      /export\s+const\s+transport\b/u,
      "const codecs",
    );
    return `${afterImports(renamed, `import { islands } from "svelte-islands";`)}\nexport const transport = islands({ codecs });\n`;
  }
  return `${afterImports(text, `import { islands } from "svelte-islands";`)}\nexport const transport = islands();\n`;
}

export function handle(text: string | null) {
  const line = `import { handle as islands } from "svelte-islands/server";`;
  if (text == null) {
    return `${line}\n\nexport const handle = islands();\n`;
  }
  if (text.includes("svelte-islands")) {
    return null;
  }
  const declared =
    /export\s+(const\s+handle\b|(async\s+)?function\s+handle\b)/u;
  const found = declared.exec(text);
  if (found == null) {
    return `${afterImports(text, line)}\nexport const handle = islands();\n`;
  }
  const replacement =
    found[1]?.startsWith("const") === true
      ? "const app"
      : `${found[2] ?? ""}function app`;
  const renamed = text.replace(declared, () => replacement);
  const sequenced =
    /import\s*\{[^}]*\bsequence\b[^}]*\}\s*from\s*["']@sveltejs\/kit\/hooks["']/u.test(
      text,
    )
      ? renamed
      : afterImports(
          renamed,
          `import { sequence } from "@sveltejs/kit/hooks";`,
        );
  return `${afterImports(sequenced, line)}\nexport const handle = sequence(islands(), app);\n`;
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
  const call = text.indexOf("sveltekit(");
  const end = call === -1 ? -1 : closing(text, call + "sveltekit".length);
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

function stepsFor(root: string): Array<Step> {
  const extension = existsSync(path.join(root, "tsconfig.json")) ? "ts" : "js";
  return [
    {
      file: pick(root, [
        `src/hooks.${extension}`,
        "src/hooks.ts",
        "src/hooks.js",
      ]),
      change: transport,
    },
    {
      file: pick(root, [
        `src/hooks.server.${extension}`,
        "src/hooks.server.ts",
        "src/hooks.server.js",
      ]),
      change: handle,
    },
    { file: "src/routes/+layout.svelte", change: layout },
    {
      file: pick(root, [
        "vite.config.ts",
        "vite.config.js",
        "vite.config.mts",
        "vite.config.mjs",
      ]),
      change: vite,
    },
  ];
}

async function contents(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

export async function run(
  args: Array<string>,
  { out, err }: Output = TERMINAL,
) {
  if (args.includes("-h") || args.includes("--help")) {
    out(USAGE);
    return 0;
  }
  const root = path.resolve(args[0] ?? ".");
  if (!existsSync(path.join(root, "package.json"))) {
    err(`There's no package.json in ${root}.`);
    err(USAGE);
    return 2;
  }
  let isClean = true;
  for (const step of stepsFor(root)) {
    const file = path.join(root, step.file);
    const before = await contents(file);
    try {
      const after = step.change(before);
      if (after == null) {
        out(`unchanged: ${step.file}`);
        continue;
      }
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, after);
      out(`${before == null ? "created" : "updated"}: ${step.file}`);
    } catch (error) {
      isClean = false;
      err(
        `skipped: ${step.file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return isClean ? 0 : 1;
}
