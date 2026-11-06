import adapterStatic from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

function isPath(value: string): value is `/${string}` {
  return value.startsWith("/");
}

const path = process.env.BASE_PATH ?? "";
const base = isPath(path) ? path : "";

function library(file: string) {
  return fileURLToPath(new URL(`../src/lib/${file}`, import.meta.url));
}

export default defineConfig({
  define: { __BASE__: JSON.stringify(base) },
  plugins: [
    sveltekit({
      adapter: adapterStatic(),
      paths: { base, relative: false },
      prerender: { entries: ["*", "/404", "/llms.txt", "/llms-full.txt"] },
      serviceWorker: { register: false },
    }),
  ],
  resolve: {
    alias: {
      "svelte-islands/server": library("server.ts"),
      "svelte-islands/styles.css": library("styles.css"),
      "svelte-islands": library("index.ts"),
    },
  },
  server: { fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
});
