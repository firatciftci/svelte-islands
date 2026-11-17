import type { Plugin } from "vite";
import path from "node:path";
import process from "node:process";
import { extract } from "./extract.js";

const ISLAND = /\.__island-[\w-]+\.svelte$/u;

/**
 * The Vite plugin that gives each island its own chunk in production builds,
 * so a page's JavaScript holds only the code outside islands. Add it next to
 * `sveltekit()`.
 *
 * ```ts
 * import { sveltekit } from "@sveltejs/kit/vite";
 * import { islands } from "svelte-islands/vite";
 * import { defineConfig } from "vite";
 *
 * export default defineConfig({ plugins: [sveltekit(), islands()] });
 * ```
 *
 * @returns The plugin.
 */
export function islands(): Plugin {
  const modules = new Map<string, string>();
  let root = process.cwd();
  return {
    name: "svelte-islands",
    enforce: "pre",
    apply: "build",
    sharedDuringBuild: true,
    configResolved(config) {
      root = config.root;
      const plugins = config.plugins as Array<Plugin>;
      const own = plugins.findIndex((plugin) => plugin.name === "svelte-islands");
      const [plugin] = own === -1 ? [] : plugins.splice(own, 1);
      if (plugin == null) {
        return;
      }
      const preprocess = plugins.findIndex(
        (each) => each.name === "vite-plugin-svelte:preprocess",
      );
      plugins.splice(preprocess === -1 ? own : preprocess + 1, 0, plugin);
    },
    resolveId(id) {
      return modules.has(id) ? id : null;
    },
    load(id) {
      return modules.get(id) ?? null;
    },
    transform: {
      filter: { id: { include: /\.svelte$/u, exclude: [/node_modules/u, ISLAND] } },
      handler(code, id) {
        const target =
          this.environment.config.consumer === "client" ? "client" : "server";
        const name = path.relative(root, id).split(path.sep).join("/");
        const extracted = extract(code, id, name, target);
        if (extracted == null) {
          return null;
        }
        if (target === "client") {
          for (const warning of extracted.warnings) {
            this.warn(warning);
          }
        }
        for (const made of extracted.modules) {
          if (made.file !== "") {
            modules.set(made.file, made.source);
          }
        }
        return { code: extracted.code, map: extracted.map };
      },
    },
  };
}
