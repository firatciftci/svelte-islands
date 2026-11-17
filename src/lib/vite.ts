import type { DevEnvironment, Environment, Plugin } from "vite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { extract } from "./extract.js";

const ISLAND = /\.__island-[\w-]+\.svelte$/u;
const BOOT = "virtual:svelte-islands/boot";
const BOOT_ID = "\0svelte-islands:boot";
const ALIAS = "virtual:svelte-islands/island/";
const ALIAS_ID = "\0svelte-islands:island:";
const SENTINEL = "__svelte_islands_boot__";
const HOOKS = ["src/hooks.ts", "src/hooks.js", "src/hooks/index.ts", "src/hooks/index.js"];

function isRunnable(environment: Environment): environment is DevEnvironment {
  return "transformRequest" in environment;
}

function bootFiles(files: ReadonlyArray<string>) {
  return JSON.stringify(JSON.stringify(files));
}

/**
 * The Vite plugin that gives each island its own chunk, so a page's JavaScript
 * holds only the code outside islands, and that boots islands on pages with
 * `csr = false`. Add it next to `sveltekit()`.
 *
 * ```ts
 * import { sveltekit } from "@sveltejs/kit/vite";
 * import { islands } from "svelte-islands/vite";
 * import { defineConfig } from "vite";
 *
 * export default defineConfig({ plugins: [sveltekit(), islands()] });
 * ```
 *
 * @returns The plugins.
 */
export function islands(): Array<Plugin> {
  const modules = new Map<string, string>();
  const pages = new Map<string, string>();
  const bodies = new Map<string, string>();
  const patched = new Set<string>();
  let root = process.cwd();
  let isServe = false;
  let boot: string | null = null;

  function own(id: string) {
    if (modules.has(id)) {
      return id;
    }
    const file = id.startsWith("/@fs/") ? id.slice(4) : path.join(root, id);
    return modules.has(file) ? file : null;
  }

  function bootSource() {
    const hooks = HOOKS.map((file) => path.join(root, file)).find((file) =>
      existsSync(file),
    );
    const lines = [`import { start } from "svelte-islands/shell";`];
    if (hooks != null) {
      lines.push(`import ${JSON.stringify(hooks)};`);
    }
    if (isServe) {
      lines.push(
        `start((id) => import(/* @vite-ignore */ new URL("./__x00__svelte-islands:island:" + id, import.meta.url).href));`,
      );
      return lines.join("\n");
    }
    const entries = [...pages.keys()].map(
      (id) => `${JSON.stringify(id)}: () => import(${JSON.stringify(`${ALIAS}${id}`)})`,
    );
    lines.push(
      `const registry = { ${entries.join(", ")} };`,
      `start((id) => registry[id]?.() ?? Promise.reject(new Error("svelte-islands: no code for the island " + id)));`,
    );
    return lines.join("\n");
  }

  return [
    {
      name: "svelte-islands",
      enforce: "pre",
      sharedDuringBuild: true,
      configResolved(config) {
        root = config.root;
        isServe = config.command === "serve";
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
      buildStart() {
        const { config, name } = this.environment;
        if (isServe || name !== "client" || pages.size === 0) {
          return;
        }
        const [output] = [config.build.rolldownOptions.output ?? {}].flat();
        if (output?.codeSplitting === false) {
          this.warn(
            "islands on pages with csr = false stay as server HTML, because the build doesn't split code. Use the default output.bundleStrategy, \"split\".",
          );
          return;
        }
        boot = this.emitFile({ type: "chunk", id: BOOT, name: "islands" });
      },
      resolveId(id) {
        if (id === BOOT) {
          return BOOT_ID;
        }
        if (id.startsWith(ALIAS)) {
          return `${ALIAS_ID}${id.slice(ALIAS.length)}`;
        }
        return own(id);
      },
      async load(id) {
        const [bare = id] = id.split("?");
        if (bare === BOOT_ID) {
          return bootSource();
        }
        if (bare.startsWith(ALIAS_ID)) {
          const island = bare.slice(ALIAS_ID.length);
          const page = pages.get(island);
          if (page != null && !bodies.has(island)) {
            const { environment } = this;
            if (isRunnable(environment)) {
              const relative = path.relative(root, page);
              await environment.transformRequest(
                relative.startsWith("..") ? `/@fs${page}` : `/${relative}`,
              );
            } else {
              await this.load({ id: page });
            }
          }
          const file = bodies.get(island);
          return file == null
            ? `throw new Error("svelte-islands: no code for the island ${island}");`
            : `export { body, url } from ${JSON.stringify(file)};`;
        }
        const file = own(id);
        return file == null ? null : (modules.get(file) ?? null);
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
            if (target === "server") {
              pages.set(made.id, id);
            } else {
              modules.set(made.file, made.source);
              bodies.set(made.id, made.file);
            }
          }
          return { code: extracted.code, map: extracted.map };
        },
      },
      writeBundle(options, bundle) {
        const { config, name } = this.environment;
        if (config.consumer !== "client") {
          for (const [file, chunk] of Object.entries(bundle)) {
            if (chunk.type === "chunk" && chunk.code.includes(SENTINEL)) {
              patched.add(path.join(options.dir ?? "", file));
            }
          }
          return;
        }
        if (boot == null || name !== "client") {
          return;
        }
        const entry = this.getFileName(boot);
        const files = [entry];
        for (const file of files) {
          const chunk = bundle[file];
          if (chunk?.type === "chunk") {
            for (const imported of chunk.imports) {
              if (!files.includes(imported)) {
                files.push(imported);
              }
            }
          }
        }
        for (const file of patched) {
          const code = readFileSync(file, "utf8");
          writeFileSync(file, code.replaceAll(`"${SENTINEL}"`, bootFiles(files)));
        }
      },
    },
    {
      name: "svelte-islands:boot",
      apply: "serve",
      transform: {
        filter: { code: SENTINEL },
        handler(code) {
          if (this.environment.config.consumer === "client") {
            return null;
          }
          return code.replaceAll(
            `"${SENTINEL}"`,
            bootFiles([`@id/__x00__${BOOT_ID.slice(1)}`]),
          );
        },
      },
    },
  ];
}
