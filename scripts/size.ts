import type { Rollup } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const INDEX = path.resolve("src/lib/index.ts");
const LIMITS = {
  "<Island> alone": {
    source: `export { Island } from "${INDEX}";`,
    limit: 11.5,
  },
  "every client export": { source: `export * from "${INDEX}";`, limit: 12.5 },
};

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
  for (const chunk of chunks.values()) {
    size[initial.has(chunk.fileName) ? "initial" : "lazy"] += gzipSync(
      chunk.code,
      { level: 9 },
    ).length;
  }
  return size;
}

let isOver = false;
for (const [name, { source, limit }] of Object.entries(LIMITS)) {
  const { initial, lazy } = await bundled(source);
  const kib = initial / 1024;
  isOver ||= kib > limit;
  process.stdout.write(
    `${name}: ${kib.toFixed(1)} KiB gzipped up front (limit ${limit} KiB), ${(lazy / 1024).toFixed(1)} KiB gzipped on demand\n`,
  );
}
process.exitCode = isOver ? 1 : 0;
