import { sveltekit } from "@sveltejs/kit/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { islands } from "../../src/lib/vite.ts";

function library(file: string) {
  return fileURLToPath(new URL(`../../src/lib/${file}`, import.meta.url));
}

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: { name: "size", adapt: () => {} },
      files: {
        routes: process.env.SIZE_ISLAND === "0" ? "src/plain" : "src/routes",
        hooks: {
          universal:
            process.env.SIZE_TRANSPORT === "0" ? "src/without" : "src/hooks",
        },
      },
    }),
    process.env.SIZE_PLUGIN === "1" && islands(),
  ],
  resolve: {
    alias: {
      "svelte-islands/server": library("server.ts"),
      "svelte-islands/shell": library("shell.svelte.ts"),
      "svelte-islands": library("index.ts"),
    },
  },
});
