import cloudflare from "@sveltejs/adapter-cloudflare";
import node from "@sveltejs/adapter-node";
import adapterStatic from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const isStatic = process.env.FIXTURE_ADAPTER === "static";
const isWorker = process.env.FIXTURE_ADAPTER === "cloudflare";
const isShared = process.env.FIXTURE_STORE === "r2";
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
      adapter: isWorker
        ? cloudflare()
        : isStatic
          ? adapterStatic({
              pages: "build-static",
              assets: "build-static",
              strict: false,
            })
          : node({ out: "build" }),
      compilerOptions: { experimental: { async: isAsync } },
      serviceWorker: { register: false },
    }),
  ],
  resolve: {
    alias: {
      "#waiting": here(
        isAsync ? "async/waiting.svelte" : "src/lib/waiting.svelte",
      ),
      "#store": here(isShared ? "workers/store.ts" : "src/lib/store.ts"),
      "svelte-islands/devtools": library("devtools.svelte"),
      "svelte-islands/stores": library("stores.ts"),
      "svelte-islands/sw": library("sw.ts"),
      "svelte-islands/server": library("server.ts"),
      "svelte-islands/styles.css": library("styles.css"),
      "svelte-islands": library("index.ts"),
    },
  },
});
