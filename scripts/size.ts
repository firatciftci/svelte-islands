/* eslint-disable no-console, node/no-process-env */
import type { Rollup } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { build, createBuilder } from "vite";

const INDEX = path.resolve("src/lib/index.ts");
const KIT = path.resolve("fixtures/size-kit");
const LIMITS = {
  "<Island> alone": 11.3,
  "every client export": 12.8,
  "Kit marginal, one island": 10.6,
  "transport per page": 1.4,
  "plugin on plain pages": 0.6,
};

type Size = keyof typeof LIMITS;

const gzipped = (code: string) => gzipSync(code, { level: 9 }).length;

function chunksOf(result: Awaited<ReturnType<typeof build>>) {
  const chunks = new Map<string, Rollup.OutputChunk>();
  for (const output of [result].flat()) {
    if (!("output" in output)) {
      continue;
    }
    for (const file of output.output) {
      if (file.type === "chunk") {
        chunks.set(file.fileName, file);
      }
    }
  }
  return chunks;
}

async function bundled(source: string) {
  const virtual = "\0size-entry";
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      svelte({ configFile: false, compilerOptions: { css: "external" } }),
      {
        name: "size-entry",
        resolveId: (id) => (id === virtual ? id : null),
        load: (id) => (id === virtual ? source : null),
      },
    ],
    resolve: { conditions: ["browser"] },
    build: {
      write: false,
      minify: true,
      rollupOptions: {
        input: virtual,
        preserveEntrySignatures: "strict",
        external: [/^svelte(?:\/|$)/u, /^@sveltejs\//u, /^\$app\//u],
      },
    },
  });
  const chunks = chunksOf(result);
  const initial = new Set<string>();
  const visit = (name: string) => {
    const chunk = chunks.get(name);
    if (chunk == null || initial.has(name)) {
      return;
    }
    initial.add(name);
    for (const imported of chunk.imports) {
      visit(imported);
    }
  };
  for (const chunk of chunks.values()) {
    if (chunk.isEntry) {
      visit(chunk.fileName);
    }
  }
  const size = { initial: 0, lazy: 0 };
  const modules = new Map<string, number>();
  for (const chunk of chunks.values()) {
    const isInitial = initial.has(chunk.fileName);
    size[isInitial ? "initial" : "lazy"] += gzipped(chunk.code);
    if (!isInitial) {
      continue;
    }
    for (const [id, { renderedLength }] of Object.entries(chunk.modules)) {
      const name = path
        .relative(process.cwd(), id.replace(/\?.*$/u, ""))
        .replace(/^.*node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?/u, "");
      modules.set(name, (modules.get(name) ?? 0) + renderedLength);
    }
  }
  return { ...size, modules };
}

type Manifest = {
  client: { start: string; app: string; imports: Array<string> };
  routes: Array<{
    id: string;
    page: { layouts: Array<number | undefined>; leaf: number } | null;
  }>;
};

async function kit(variant: Record<string, string>) {
  Object.assign(process.env, variant);
  const home = process.cwd();
  const { log } = console;
  process.chdir(KIT);
  console.log = () => {};
  try {
    const builder = await createBuilder({ logLevel: "silent" });
    await builder.buildApp();
  } finally {
    console.log = log;
    process.chdir(home);
  }
  const output = path.join(KIT, ".svelte-kit/output");
  const url = pathToFileURL(path.join(output, "server/manifest.js"));
  url.search = String(Date.now());
  const { manifest } = (await import(url.href)) as { manifest: Manifest };
  const { client, routes } = manifest;
  return (id: string) => {
    const route = routes.find((found) => found.id === id);
    if (route?.page == null) {
      throw new Error(`The size fixture has no page at ${id}.`);
    }
    const files = new Set([client.start, client.app, ...client.imports]);
    for (const index of [...route.page.layouts, route.page.leaf]) {
      if (index == null) {
        continue;
      }
      const node = readFileSync(
        path.join(output, `server/nodes/${index}.js`),
        "utf8",
      );
      const listed = /export const imports = (\[.*?\]);/u.exec(node)?.[1];
      const imported = JSON.parse(listed ?? "[]") as Array<string>;
      for (const file of imported) {
        files.add(file);
      }
    }
    let total = 0;
    for (const file of files) {
      total += gzipped(readFileSync(path.join(output, "client", file), "utf8"));
    }
    return total;
  };
}

const sizes = new Map<Size, number>();
const report = (name: Size, bytes: number, extra = "") => {
  sizes.set(name, bytes);
  process.stdout.write(
    `${name}: ${(bytes / 1024).toFixed(2)} KiB gzipped (limit ${LIMITS[name]} KiB)${extra}\n`,
  );
};

const alone = await bundled(`export { Island } from "${INDEX}";`);
report("<Island> alone", alone.initial);
const all = await bundled(`export * from "${INDEX}";`);
report(
  "every client export",
  all.initial,
  `, ${(all.lazy / 1024).toFixed(2)} KiB on demand`,
);

const island = await kit({
  SIZE_ISLAND: "1",
  SIZE_TRANSPORT: "1",
  SIZE_PLUGIN: "0",
});
const islandRows = island("/rows");
const islandHome = island("/");
const plain = await kit({
  SIZE_ISLAND: "0",
  SIZE_TRANSPORT: "1",
  SIZE_PLUGIN: "0",
});
report("Kit marginal, one island", islandRows - plain("/rows"));
const plainHome = plain("/");
const bare = await kit({
  SIZE_ISLAND: "0",
  SIZE_TRANSPORT: "0",
  SIZE_PLUGIN: "0",
});
report("transport per page", plainHome - bare("/"));
const split = await kit({
  SIZE_ISLAND: "1",
  SIZE_TRANSPORT: "1",
  SIZE_PLUGIN: "1",
});
report("plugin on plain pages", split("/") - islandHome);

let whole = 0;
for (const length of alone.modules.values()) {
  whole += length;
}
process.stdout.write("\n<Island> alone, by module (share of rendered code):\n");
const topModules = [...alone.modules]
  .toSorted((a, b) => b[1] - a[1])
  .slice(0, 10);
for (const [name, length] of topModules) {
  process.stdout.write(
    `  ${((length / whole) * 100).toFixed(1).padStart(5)}%  ${name}\n`,
  );
}

let isOver = false;
for (const [name, bytes] of sizes) {
  isOver ||= bytes / 1024 > LIMITS[name];
}
process.exitCode = isOver ? 1 : 0;
