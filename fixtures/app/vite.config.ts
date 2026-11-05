import node from "@sveltejs/adapter-node";
import adapterStatic from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const isStatic = process.env.FIXTURE_ADAPTER === "static";
const isAsync = process.env.FIXTURE_ASYNC === "1";

function library(file: string) {
  return fileURLToPath(new URL(`../../src/lib/${file}`, import.meta.url));
}

function here(file: string) {
  return fileURLToPath(new URL(file, import.meta.url));
}

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: isStatic
        ? adapterStatic({
            pages: "build-static",
            assets: "build-static",
            strict: false,
          })
        : node({ out: "build" }),
      compilerOptions: { experimental: { async: isAsync } },
    }),
  ],
  resolve: {
    alias: {
      "#waiting": here(
        isAsync ? "async/waiting.svelte" : "src/lib/waiting.svelte",
      ),
      "svelte-islands/devtools": library("devtools.svelte"),
      "svelte-islands/server": library("server.ts"),
      "svelte-islands/styles.css": library("styles.css"),
      "svelte-islands": library("index.ts"),
    },
  },
});
