import { svelte } from "@sveltejs/vite-plugin-svelte";
import { Buffer } from "node:buffer";
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
  const outputs = Array.isArray(result) ? result : [result];
  const files = outputs.flatMap((entry) =>
    "output" in entry ? entry.output : [],
  );
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    if (file.type !== "chunk") {
      continue;
    }
    raw += Buffer.byteLength(file.code);
    gzip += gzipSync(file.code, { level: 9 }).length;
  }
  return { raw, gzip };
}

let isOver = false;
for (const [name, { source, limit }] of Object.entries(LIMITS)) {
  const { raw, gzip } = await bundled(source);
  const kib = gzip / 1024;
  isOver ||= kib > limit;
  process.stdout.write(
    `${name}: ${(raw / 1024).toFixed(1)} KiB, ${kib.toFixed(1)} KiB gzipped, limit ${limit} KiB\n`,
  );
}
process.exitCode = isOver ? 1 : 0;
